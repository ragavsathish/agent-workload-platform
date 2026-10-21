#!/usr/local/bin/bb

(ns oracle
  (:require [babashka.fs :as fs]
            [cheshire.core :as json])
  (:import [java.net URI]
           [java.net.http HttpClient HttpRequest HttpRequest$BodyPublishers HttpResponse$BodyHandlers]
           [java.nio.file Files]
           [java.security MessageDigest SecureRandom]
           [java.time Duration]
           [java.util Base64]
           [java.util.zip CRC32 ZipFile]))

(defn hex [bytes]
  (apply str (map #(format "%02x" (bit-and 0xff %)) bytes)))

(defn sha256 [path]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (with-open [input (Files/newInputStream (fs/path path) (make-array java.nio.file.OpenOption 0))]
      (let [buffer (byte-array 8192)]
        (loop []
          (let [size (.read input buffer)]
            (when (pos? size)
              (.update digest buffer 0 size)
              (recur))))))
    (hex (.digest digest))))

(defn valid-zip? [path]
  (try
    (with-open [zip (ZipFile. (str path))]
      (let [names (set (map #(.getName %) (enumeration-seq (.entries zip))))]
        (when (and (contains? names "trace.trace") (contains? names "trace.network"))
          (doseq [entry (enumeration-seq (.entries zip))]
            (with-open [input (.getInputStream zip entry)]
              (let [buffer (byte-array 8192)
                    crc (CRC32.)]
                (loop []
                  (let [size (.read input buffer)]
                    (when (pos? size)
                      (.update crc buffer 0 size)
                      (recur))))
                (when (not= (.getValue crc) (.getCrc entry))
                  (throw (ex-info "Trace ZIP CRC mismatch" {:entry (.getName entry)}))))))
          true)))
    (catch Exception _ false)))

(defn browser-traces [run-dir]
  (let [summary (json/parse-string (slurp (str run-dir "/evidence.json")))
        traces (get summary "traces" [])
        failures (atom (vec (get summary "inspectionFailures" [])))
        journeys (into {}
                       (for [journey ["voice" "workspace"]]
                         (let [archives (vec (fs/glob (str run-dir "/results/" journey) "**/trace.zip"))]
                           (if (not= 1 (count archives))
                             (do (swap! failures conj (str journey ": expected one trace, found " (count archives)))
                                 [journey nil])
                             (let [archive (first archives)
                                   digest (sha256 archive)
                                   matches (filter #(= digest (get % "sha256")) traces)
                                   item (first matches)
                                   actions (reduce + 0 (vals (get item "browserActions" {})))
                                   requests (get item "networkRequests" 0)]
                               (when (not= 1 (count matches))
                                 (swap! failures conj (str journey ": trace SHA-256 absent or duplicated in evidence")))
                               (when-not (valid-zip? archive)
                                 (swap! failures conj (str journey ": incomplete or unreadable trace ZIP")))
                               (doseq [field ["badResponses" "networkFailures" "consoleErrors"]]
                                 (when (seq (get item field))
                                   (swap! failures conj (str journey ": " field " present"))))
                               (when (or (< actions 1) (< requests 1))
                                 (swap! failures conj (str journey ": no browser actions or network requests")))
                               (when (and (= journey "workspace")
                                          (not-any? #(and (= "POST" (get % "method"))
                                                          (= "/api/pi-message" (get % "path"))
                                                          (= 200 (get % "status")))
                                                    (get item "apiRequests" [])))
                                 (swap! failures conj "workspace: successful POST /api/pi-message absent"))
                               [journey {"sha256" digest "actions" actions "networkRequests" requests}])))))]
    (when (not= 2 (count traces))
      (swap! failures conj (str "expected two inspected traces, found " (count traces))))
    {"passed" (empty? @failures) "journeys" journeys "failures" @failures}))

(defn random-id [size]
  (let [bytes (byte-array size)]
    (.nextBytes (SecureRandom.) bytes)
    (hex bytes)))

(defn attributes [values]
  (mapv (fn [[key value]] {"key" key "value" {"stringValue" value}}) values))

(def http-client (-> (HttpClient/newBuilder)
                     (.connectTimeout (Duration/ofSeconds 5))
                     (.build)))

(defn request-json [url payload]
  (let [builder (-> (HttpRequest/newBuilder (URI/create url))
                    (.timeout (Duration/ofSeconds 5))
                    (.header "Accept" "application/json"))
        request (if payload
                  (-> builder
                      (.header "Content-Type" "application/json")
                      (.POST (HttpRequest$BodyPublishers/ofString (json/generate-string payload)))
                      (.build))
                  (.build (.GET builder)))
        response (.send http-client request (HttpResponse$BodyHandlers/ofString))]
    (when-not (<= 200 (.statusCode response) 299)
      (throw (ex-info (str "HTTP " (.statusCode response)) {"url" url})))
    (json/parse-string (.body response))))

(defn id-matches? [observed expected]
  (or (= expected (some-> observed .toLowerCase))
      (try
        (= expected (hex (.decode (Base64/getDecoder) ^String observed)))
        (catch Exception _ false))))

(defn returned-canary? [response trace-id span-id expected-attributes]
  (boolean
   (some (fn [span]
           (let [found (into {} (map (fn [attribute]
                                       [(get attribute "key") (get-in attribute ["value" "stringValue"])])
                                 (get span "attributes" [])))]
             (and (id-matches? (get span "traceId") trace-id)
                  (id-matches? (get span "spanId") span-id)
                  (= "patrol.oracle.canary" (get span "name"))
                  (every? (fn [[key value]] (= value (get found key))) expected-attributes))))
         (for [resource (get-in response ["trace" "resourceSpans"])
               scope (get resource "scopeSpans")
               span (get scope "spans")]
           span))))

(defn otel-canary [collector tempo run-id vm-index]
  (let [trace-id (random-id 16)
        span-id (random-id 8)
        now (str (* 1000000 (System/currentTimeMillis)))
        canary-attributes {"benchmark.run_id" run-id "benchmark.vm_index" (str vm-index)}
        payload {"resourceSpans"
                 [{"resource" {"attributes" (attributes {"service.name" "awp-patrol-oracle"})}
                   "scopeSpans" [{"scope" {"name" "awp.patrol-oracle"}
                                  "spans" [{"traceId" trace-id "spanId" span-id
                                            "name" "patrol.oracle.canary"
                                            "startTimeUnixNano" now
                                            "endTimeUnixNano" (str (+ 1000000 (Long/parseLong now)))
                                            "attributes" (attributes canary-attributes)}]}]}]}
        result {"traceId" trace-id "spanId" span-id "collector" collector
                "tempo" tempo "passed" false "failures" []}]
    (try
      (let [accepted (request-json (str collector "/v1/traces") payload)]
        (when (pos? (get-in accepted ["partialSuccess" "rejectedSpans"] 0))
          (throw (ex-info "collector rejected the canary span" {}))))
      (let [deadline (+ (System/currentTimeMillis) 30000)]
        (loop []
          (let [response (try (request-json (str tempo "/api/v2/traces/" trace-id) nil)
                              (catch Exception _ nil))]
            (cond
              (returned-canary? response trace-id span-id canary-attributes)
              (assoc result "passed" true)

              (>= (System/currentTimeMillis) deadline)
              (assoc result "failures" ["canary span not returned by Tempo before deadline"])

              :else (do (Thread/sleep 1000) (recur))))))
      (catch Exception error
        (assoc result "failures" [(str "OTLP export failed: " (.getMessage error))])))))

(defn evaluate [run-dir run-id vm-index]
  (let [browser (try (browser-traces run-dir)
                     (catch Exception error
                       {"passed" false "failures" [(str "trace inspection failed: " (.getMessage error))]}))
        collector (or (System/getenv "ORACLE_OTLP_COLLECTOR") "http://127.0.0.1:4318")
        tempo (or (System/getenv "ORACLE_TEMPO") "http://127.0.0.1:3200")
        otel (otel-canary collector tempo run-id vm-index)]
    {"passed" (and (get browser "passed") (get otel "passed"))
     "browserTrace" browser "otel" otel}))

(defn -main [& args]
  (when-not (= 3 (count args))
    (binding [*out* *err*]
      (println "Usage: oracle.clj <patrol-run-dir> <run-id> <vm-index>"))
    (System/exit 2))
  (let [[run-dir run-id vm-index] args
        result (evaluate run-dir run-id (Long/parseLong vm-index))]
    (println (json/generate-string result))
    (System/exit (if (get result "passed") 0 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
