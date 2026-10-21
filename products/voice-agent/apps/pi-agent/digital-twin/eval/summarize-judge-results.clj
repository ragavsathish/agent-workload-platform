(ns summarize-judge-results
  (:require [cheshire.core :as json]))

(def ^:private human-verdicts #{"correct" "uncertain" "incorrect"})

(defn- verdict-from-score [score]
  (let [score (if (number? score) score (try (Double/parseDouble (str score)) (catch Exception _ Double/NaN)))]
    (cond (== score 0.0) "incorrect"
          (== score 0.5) "uncertain"
          (== score 1.0) "correct"
          :else nil)))

(defn- summarize-rows [rows]
  (let [reviewed (filter #(contains? human-verdicts (:humanVerdict %)) rows)
        judged (filter #(and (not (:notJudged %)) (:judgeVerdict %)) reviewed)
        agreements (count (filter #(= (:judgeVerdict %) (:humanVerdict %)) judged))]
    {:total (count rows)
     :reviewed (count reviewed)
     :unreviewed (- (count rows) (count reviewed))
     :judged (count judged)
     :notJudged (count (filter :notJudged rows))
     :agreements agreements
     :agreementRate (when (seq judged) (/ agreements (double (count judged))))}))

(defn summarize-judge-results [document]
  (let [raw-rows (get-in document [:results :results])]
    (when-not (sequential? raw-rows)
      (throw (ex-info "Promptfoo result JSON has no results.results array" {})))
    (let [rows (mapv (fn [row]
                       (let [component (some #(when (= "selene_judge" (get-in % [:assertion :metric])) %)
                                              (get-in row [:gradingResult :componentResults]))
                             not-judged (or (nil? component) (true? (get-in component [:metadata :graderError])))]
                         {:description (get-in row [:testCase :description])
                          :goldCase (get-in row [:metadata :goldCase])
                          :split (or (get-in row [:metadata :split]) "unspecified")
                          :humanVerdict (or (get-in row [:metadata :humanVerdict]) "unreviewed")
                          :judgeVerdict (when-not not-judged (verdict-from-score (:score component)))
                          :notJudged not-judged
                          :reason (or (:reason component) "Missing Selene judge result")}))
                     raw-rows)
          splits (into {} (for [[split split-rows] (group-by :split rows)]
                            [split (summarize-rows split-rows)]))]
      {:overall (summarize-rows rows)
       :splits splits
       :rows (filterv :notJudged rows)})))

(defn -main [& args]
  (when-not (= 1 (count args))
    (throw (ex-info "Usage: bb summarize-judge-results.clj <promptfoo-results.json>" {})))
  (let [document (json/parse-string (slurp (first args)) true)]
    (println (json/generate-string (summarize-judge-results document) {:pretty true}))))

(when (= *file* (System/getProperty "babashka.file"))
  (try
    (apply -main *command-line-args*)
    (catch Exception error
      (binding [*out* *err*] (println (.getMessage error)))
      (System/exit 1))))
