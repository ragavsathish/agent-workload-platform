(ns oracle-test
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.test :refer [deftest is run-tests]])
  (:import [java.io FileOutputStream]
           [java.util.zip ZipEntry ZipOutputStream]))

(load-file "platform/agent-execution/gondolin-session/tools/oracle.clj")

(deftest canary-requires-the-exported-span
  (let [posted (atom nil)
        request (fn [_ payload]
                  (if payload
                    (do (reset! posted (get-in payload ["resourceSpans" 0 "scopeSpans" 0 "spans" 0])) {})
                    {"trace" {"resourceSpans"
                               [{"scopeSpans" [{"spans" [@posted]}]}]}}))]
    (with-redefs [oracle/request-json request]
      (is (true? (get (oracle/otel-canary "http://collector" "http://tempo" "run-1" 2) "passed")))
      (is (= "2" (get-in @posted ["attributes" 1 "value" "stringValue"]))))
    (is (false? (oracle/returned-canary?
                 {"trace" {"resourceSpans" [{"scopeSpans" [{"spans" [(assoc @posted "name" "other")]}]}]}}
                 (get @posted "traceId") (get @posted "spanId")
                 {"benchmark.run_id" "run-1" "benchmark.vm_index" "2"})))))

(deftest browser-trace-requires-workspace-message
  (let [run-dir (str (fs/create-temp-dir {:prefix "oracle-test-"}))]
    (try
      (let [traces
            (mapv (fn [journey]
                    (let [archive (str run-dir "/results/" journey "/test/trace.zip")]
                      (fs/create-dirs (fs/parent archive))
                      (with-open [zip (ZipOutputStream. (FileOutputStream. archive))]
                        (doseq [name ["trace.trace" "trace.network"]]
                          (.putNextEntry zip (ZipEntry. name))
                          (.write zip (.getBytes (str journey " {}\n") "UTF-8"))
                          (.closeEntry zip)))
                      {"sha256" (oracle/sha256 archive)
                       "browserActions" {"goto" 1} "networkRequests" 1
                       "apiRequests" (if (= journey "workspace")
                                       [{"method" "POST" "path" "/api/pi-message" "status" 200}] [])}))
                  ["voice" "workspace"])
            evidence (str run-dir "/evidence.json")]
        (spit evidence (json/generate-string {"traces" traces "inspectionFailures" []}))
        (is (true? (get (oracle/browser-traces run-dir) "passed")))
        (spit evidence (json/generate-string {"traces" (assoc-in traces [1 "apiRequests"] [])
                                             "inspectionFailures" []}))
        (is (false? (get (oracle/browser-traces run-dir) "passed"))))
      (finally (fs/delete-tree run-dir)))))

(let [result (run-tests 'oracle-test)]
  (System/exit (if (zero? (+ (:fail result) (:error result))) 0 1)))
