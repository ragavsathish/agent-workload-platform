(load-file "tool/inspect-patrol-trace.clj")
(load-file "tool/patch-patrol-web-trace.clj")

(ns patrol-tools-test
  (:require [cheshire.core :as json]
            [clojure.test :refer [deftest is testing run-tests]]
            [babashka.fs :as fs])
  (:import [java.io FileOutputStream]
           [java.nio.charset StandardCharsets]
           [java.util.zip ZipEntry ZipOutputStream]))

(defn temp-file [suffix]
  (fs/create-temp-file {:prefix "patrol-tools-test-" :suffix suffix}))

(defn zip-entry! [^ZipOutputStream zip name contents]
  (.putNextEntry zip (ZipEntry. name))
  (.write zip (.getBytes contents StandardCharsets/UTF_8))
  (.closeEntry zip))

(defn trace-archive! [path request]
  (with-open [zip (ZipOutputStream. (FileOutputStream. (str path)))]
    (zip-entry! zip "trace.trace" "")
    (zip-entry! zip "trace.network"
                (str (json/generate-string
                      {"type" "resource-snapshot"
                       "snapshot" {"request" (merge {"method" "GET" "headers" []} request)
                                   "response" {"status" -1 "_failureText" (get request "failureText")}}})
                     "\n"))))

(deftest inspector-classifies-observed-navigation-aborts
  (testing "popup assets aborted during navigation are expected"
    (let [archive (temp-file ".zip")]
      (try
        (trace-archive! archive {"url" "http://localhost/flutter_bootstrap.js"
                                "headers" [{"name" "referer" "value" "http://localhost/?view=transcript"}]
                                "failureText" "net::ERR_ABORTED"})
        (let [summary (inspect-patrol-trace/summarize-trace (str archive))]
          (is (= 1 (count (get summary "expectedCancellations"))))
          (is (empty? (get summary "networkFailures"))))
        (finally (fs/delete-if-exists archive)))))
  (testing "connection resets still count as failures"
    (let [archive (temp-file ".zip")]
      (try
        (trace-archive! archive {"url" "http://localhost/flutter_bootstrap.js"
                                "failureText" "net::ERR_CONNECTION_RESET"})
        (let [summary (inspect-patrol-trace/summarize-trace (str archive))]
          (is (= 1 (count (get summary "networkFailures"))))
          (is (empty? (get summary "expectedCancellations"))))
        (finally (fs/delete-if-exists archive))))))

(deftest patcher-is-idempotent-and-rejects-partial-patches
  (let [runner (temp-file ".ts")
        fixture (str "  page: async ({ page, context }, use, testInfo) => {\n"
                     "    for (const p of context.pages()) {\n"
                     "      if (p !== page && !p.isClosed()) {\n"
                     "        await p.close().catch(() => {})\n"
                     "      }\n"
                     "    }\n")]
    (try
      (spit (str runner) fixture)
      (patch-patrol-web-trace/patch-runner! runner)
      (let [patched (slurp (str runner))]
        (is (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote patch-patrol-web-trace/start-marker)) patched))))
        (is (= 1 (count (re-seq (re-pattern (java.util.regex.Pattern/quote patch-patrol-web-trace/stop-marker)) patched))))
        (patch-patrol-web-trace/patch-runner! runner)
        (is (= patched (slurp (str runner)))))
      (spit (str runner) (str fixture patch-patrol-web-trace/start-marker))
      (is (thrown-with-msg? clojure.lang.ExceptionInfo #"partial trace patch"
                            (patch-patrol-web-trace/patch-runner! runner)))
      (finally (fs/delete-if-exists runner)))))

(defn -main [& _]
  (let [{:keys [fail error]} (run-tests 'patrol-tools-test)]
    (when (pos? (+ fail error)) (System/exit 1))))

(when (= *file* (System/getProperty "babashka.file"))
  (-main))
