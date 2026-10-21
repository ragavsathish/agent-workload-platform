(ns inspect-patrol-trace
  (:require [cheshire.core :as json]
            [clojure.java.io :as io]
            [clojure.string :as str]
            [babashka.fs :as fs])
  (:import [java.net URL]
           [java.security MessageDigest]
           [java.time Instant]
           [java.util.zip ZipFile]))

(defn sha256 [bytes]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256") bytes)]
    (apply str (map #(format "%02x" (bit-and 0xff %)) digest))))

(defn relative-path [path]
  (str (.relativize (.toAbsolutePath (fs/path (System/getProperty "user.dir")))
                    (.toAbsolutePath (fs/path path)))))

(defn traces-under [directory]
  (if-not (fs/exists? directory)
    []
    (->> (fs/glob directory "**/trace.zip") (map str) sort vec)))

(defn zip-json-lines [archive member]
  (with-open [zip (ZipFile. (str archive))]
    (if-let [entry (.getEntry zip member)]
      (with-open [reader (io/reader (.getInputStream zip entry))]
        (->> (line-seq reader) (remove str/blank?) (mapv json/parse-string)))
      (throw (ex-info "Trace archive member is missing" {:archive archive :member member})))))

(defn validate-zip! [archive]
  (with-open [zip (ZipFile. (str archive))]
    (doseq [entry (enumeration-seq (.entries zip))]
      (with-open [input (.getInputStream zip entry)]
        (let [buffer (byte-array 8192)]
          (loop []
            (when-not (neg? (.read input buffer)) (recur))))))))

(defn url-part [url include-query?]
  (try
    (let [parsed (URL. url)]
      (str (.getPath parsed) (when (and include-query? (.getQuery parsed)) (str "?" (.getQuery parsed)))))
    (catch Exception _ "<invalid-url>")))

(defn header-value [headers name]
  (or (some (fn [header]
              (when (= (str/lower-case name) (str/lower-case (get header "name" "")))
                (get header "value"))) headers) ""))

(defn request-of [event]
  (let [request (get-in event ["snapshot" "request"])
        response (get-in event ["snapshot" "response"])
        url (get request "url" "")]
    {"method" (get request "method" "<unknown>")
     "path" (url-part url false)
     "initiator" (url-part (header-value (get request "headers") "referer") true)
     "status" (get response "status" -1)
     "failureText" (get response "_failureText" "")}))

(defn method-counts [calls]
  (reduce (fn [counts event]
            (update counts (get event "method" "<unknown>") (fnil inc 0))) {} calls))

(defn redacted-console-message [event]
  (let [text (str (get event "text" ""))]
    {"type" (get event "messageType" "unknown")
     "bytes" (alength (.getBytes text "UTF-8"))
     "sha256" (sha256 (.getBytes text "UTF-8"))}))

(defn popup-static-asset? [request]
  (let [path (get request "path")]
    (or (= path "/flutter_bootstrap.js")
        (boolean (re-matches #"/voice-runtime/[a-zA-Z0-9_-]+\.js" path)))))

(defn navigation-popup? [request]
  (let [path (get request "path") initiator (get request "initiator")]
    (or (and (= initiator "/?view=transcript"))
        (= initiator "/metrics/d/voice-c4-heatmap/c4-operational-heat-map")
        (and (str/starts-with? path "/voice-runtime/chunk-")
             (= initiator "/voice-runtime/voice_bridge.js")))))

(defn expected-cancellation? [request]
  (and (<= (get request "status" -1) 0)
       (or (and (= "POST" (get request "method")) (= "/api/pi-speech" (get request "path")))
           (and (= "GET" (get request "method")) (popup-static-asset? request) (navigation-popup? request))
           (and (= "GET" (get request "method"))
                (= "net::ERR_ABORTED" (get request "failureText"))
                (or (and (popup-static-asset? request) (= "<invalid-url>" (get request "initiator")))
                    (and (= "/excalidraw/mcp-app.html" (get request "path"))
                         (= "/?view=transcript" (get request "initiator"))))))))

(defn summarize-trace [trace-path]
  (let [_ (validate-zip! trace-path)
        trace (zip-json-lines trace-path "trace.trace")
        network (zip-json-lines trace-path "trace.network")
        calls (filter #(= "before" (get % "type")) trace)
        console-events (filter #(= "console" (get % "type")) trace)
        requests (->> network (filter #(= "resource-snapshot" (get % "type"))) (mapv request-of))
        failures (filterv #(and (<= (get % "status") 0) (not (expected-cancellation? %))) requests)
        cancellations (filterv expected-cancellation? requests)
        bad-responses (filterv #(>= (get % "status") 400) requests)
        bytes (fs/read-all-bytes trace-path)]
    {"trace" (relative-path trace-path)
     "bytes" (alength bytes)
     "sha256" (sha256 bytes)
     "browserActions" (method-counts calls)
     "networkRequests" (count requests)
     "apiRequests" (filterv #(str/starts-with? (get % "path") "/api/") requests)
     "badResponses" bad-responses
     "networkFailures" failures
     "expectedCancellations" cancellations
     "consoleErrors" (->> console-events (filter #(= "error" (get % "messageType"))) (mapv redacted-console-message))
     "consoleWarnings" (->> console-events (filter #(= "warning" (get % "messageType"))) (mapv redacted-console-message))
     "screenshots" (count (filter #(= "screencast-frame" (get % "type")) trace))}))

(defn inspect-trace [trace-path]
  (try
    {"type" "Ok" "value" (summarize-trace trace-path)}
    (catch Exception _
      {"type" "Err" "error" {"type" "TraceInspectionFailed" "trace" (relative-path trace-path)}})))

(defn run-inspection [results-dir output-path]
  (let [traces (traces-under results-dir)
        inspected (mapv inspect-trace traces)
        evidence (mapv #(get % "value") (filter #(= "Ok" (get % "type")) inspected))
        failures (mapv #(get % "error") (filter #(= "Err" (get % "type")) inspected))
        failures (if (seq traces) failures
                     (conj failures {"type" "TraceNotFound" "directory" (relative-path results-dir)}))
        summary {"generatedAt" (str (Instant/now)) "traces" evidence "inspectionFailures" failures}]
    (fs/create-dirs (fs/parent output-path))
    (spit (str output-path) (str (json/generate-string summary {:pretty true}) "\n"))
    (doseq [item evidence]
      (println "Trace evidence:" (get item "trace"))
      (println "  SHA-256:" (get item "sha256"))
      (println "  Actions:" (reduce + 0 (vals (get item "browserActions"))))
      (println "  Network:" (get item "networkRequests") "requests," (count (get item "badResponses")) "bad responses," (count (get item "networkFailures")) "failures")
      (println "  Console:" (count (get item "consoleErrors")) "errors," (count (get item "consoleWarnings")) "warnings")
      (println "  API requests:" (count (get item "apiRequests")))
      (println "  Screenshots:" (get item "screenshots")))
    (when (or (seq failures)
              (some #(or (seq (get % "badResponses")) (seq (get % "networkFailures")) (seq (get % "consoleErrors"))) evidence))
      (System/exit 1))))

(defn -main [& args]
  (when-not (= 2 (count args))
    (throw (ex-info "Usage: inspect-patrol-trace.clj <results-dir> <output-json>" {})))
  (run-inspection (first args) (second args)))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
