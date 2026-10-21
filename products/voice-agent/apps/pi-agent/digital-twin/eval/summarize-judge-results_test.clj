(ns summarize-judge-results-test
  (:require [clojure.test :refer [deftest is testing run-tests]]))

(load-file "digital-twin/eval/summarize-judge-results.clj")

(def document
  {:results {:results
             [{:testCase {:description "reviewed and correct"}
               :metadata {:goldCase "gold-1" :split "train" :humanVerdict "correct"}
               :gradingResult {:componentResults [{:assertion {:metric "selene_judge"}
                                                   :score 1 :reason "matches"}]}}
              {:testCase {:description "grader failed"}
               :metadata {:goldCase "gold-2" :split "train" :humanVerdict "incorrect"}
               :gradingResult {:componentResults [{:assertion {:metric "selene_judge"}
                                                   :metadata {:graderError true}
                                                   :score 1 :reason "must not count"}]}}
              {:testCase {:description "not human reviewed"}
               :gradingResult {:componentResults [{:assertion {:metric "selene_judge"}
                                                   :score 0.5 :reason "uncertain"}]}}]}})

(deftest summarizes-reviewed-judge-results-and-errors
  (let [summary (summarize-judge-results/summarize-judge-results document)]
    (is (= {:total 3 :reviewed 2 :unreviewed 1 :judged 1 :notJudged 1
            :agreements 1 :agreementRate 1.0}
           (:overall summary)))
    (is (= #{"train" "unspecified"} (set (keys (:splits summary)))))
    (is (= ["grader failed"] (mapv :description (:rows summary))))
    (is (= "must not count" (:reason (first (:rows summary)))))))

(deftest rejects-promptfoo-json-without-results
  (testing "the report requires the Promptfoo results.results array"
    (is (thrown-with-msg? clojure.lang.ExceptionInfo #"no results.results array"
                          (summarize-judge-results/summarize-judge-results {})))))

(let [{:keys [fail error]} (run-tests 'summarize-judge-results-test)]
  (when (pos? (+ fail error)) (System/exit 1)))
