(ns journal-annotation-export-test
  (:require [clojure.test :refer [deftest is testing]]
            [journal-annotation-export :as exporter])
  (:import [java.nio.file Files]
           [java.nio.file.attribute PosixFilePermission]))

(def sample-rows
  [{:capture "urn:c1" :transcript "one" :entry "urn:e1" :predictedType "decision" :predictedText "A" :topic "zeta"}
   {:capture "urn:c1" :transcript "one" :entry "urn:e1" :predictedType "decision" :predictedText "A" :topic "alpha"}
   {:capture "urn:c2" :transcript "two"}
   {:capture "urn:c3" :transcript "three" :entry "urn:e3" :predictedType "skill" :predictedText "B" :topic "topic"}])

(deftest arguments-validate-options
  (is (= {:query-url "http://localhost/query" :limit 3 :output "x.json"}
         (exporter/parse-args ["--query-url" "http://localhost/query" "--limit" "3" "--output" "x.json"])))
  (is (:help (exporter/parse-args ["--help"])))
  (is (thrown? Exception (exporter/parse-args ["--limit" "0"])))
  (is (thrown? Exception (exporter/parse-args ["--surprise"]))))

(deftest sparql-results-group-deterministically-and-deduplicate-topics
  (let [grouped (exporter/group-captures sample-rows)]
    (is (= ["urn:c1" "urn:c2" "urn:c3"] (mapv :capture grouped)))
    (is (= [{:type "decision" :text "A" :topics ["zeta" "alpha"]}]
           (:predicted-entries (first grouped))))
    (is (= 0 (count (:predicted-entries (second grouped)))))
    (is (= (exporter/stable-rank "urn:c1") (exporter/stable-rank "urn:c1")))
    (is (= (mapv :capture (exporter/stratified-sample grouped 3))
           (mapv :capture (exporter/stratified-sample grouped 3))))
    (is (= 2 (count (set (map #(first (:predicted-entries %)) (exporter/stratified-sample grouped 2))))))))

(deftest output-schema-is-pending-review-and-identifiers-are-stable
  (let [grouped (exporter/group-captures sample-rows)
        document (exporter/output-document grouped grouped "2026-10-21")
        case (first (:cases document))]
    (is (= "journal-review-2026-10-21" (:datasetId document)))
    (is (= "pending" (get-in document [:privacyReview :status])))
    (is (= (:id case) (:semanticFamilyId case)))
    (is (= "pending" (:annotationStatus case)))
    (is (= [] (:expectedEntries case)))))

(deftest exported-file-is-created-private-and-never-overwritten
  (let [directory (Files/createTempDirectory "journal-export-test" (make-array java.nio.file.attribute.FileAttribute 0))
        output (.resolve directory "private.json")]
    (try
      (exporter/write-private! output "{}\n")
      (is (= #{PosixFilePermission/OWNER_READ PosixFilePermission/OWNER_WRITE}
             (set (Files/getPosixFilePermissions output (make-array java.nio.file.LinkOption 0)))))
      (is (thrown? Exception (exporter/write-private! output "{}\n")))
      (finally
        (Files/deleteIfExists output)
        (Files/deleteIfExists directory)))))

(defn -main [& _]
  (let [result (clojure.test/run-tests 'journal-annotation-export-test)]
    (when (pos? (+ (:fail result) (:error result))) (System/exit 1))))

(when (= *file* (System/getProperty "babashka.file")) (-main))
