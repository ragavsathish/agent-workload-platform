(ns container-mock.diagnostics-test
  (:require [clojure.test :refer [deftest is testing run-tests]]
            [cheshire.core :as json]
            [container-mock.diagnostics :as diagnostics]))

(defn- call [state method path body]
  (diagnostics/transition state {:method method :path path
                                 :body (when body (json/generate-string body))}))

(deftest diagnostic-scenarios-preserve-public-contract
  (doseq [[scenario expected-status expected-count]
          [["ready" 200 1] ["empty" 200 0] ["truncated" 200 1]
           ["metrics-unavailable" 200 1] ["unavailable" 503 nil]]]
    (testing scenario
      (let [selected (call (diagnostics/initial-state) "POST" "/__fixture/diagnostics/scenario"
                           {:scenario scenario})
            listed (call (:state selected) "GET" "/api/audio-diagnostics" nil)
            payload (json/parse-string (get-in listed [:response :body]) true)]
        (is (= 200 (get-in selected [:response :status])))
        (is (= expected-status (get-in listed [:response :status])))
        (when expected-count (is (= expected-count (count (:sessions payload)))))
        (when (= scenario "truncated")
          (is (= 2 (get-in payload [:sessions 0 :droppedChunks])))
          (is (true? (get-in payload [:sessions 0 :truncated]))))
        (is (= scenario (get-in listed [:state :events 0 :scenario])))))))

(deftest diagnostic-contract-rejects-unexpected-calls
  (let [state (diagnostics/initial-state)]
    (is (= 400 (get-in (call state "POST" "/__fixture/diagnostics/scenario" {:scenario "invented"})
                       [:response :status])))
    (is (= 405 (get-in (call state "POST" "/api/audio-diagnostics" nil) [:response :status])))
    (is (= 404 (get-in (call state "GET" "/api/audio-diagnostics/missing/metrics" nil)
                       [:response :status])))
    (is (= "audio/wav" (get-in (call state "GET" (str "/api/audio-diagnostics/" diagnostics/session-id "/raw.wav") nil)
                                 [:response :headers "Content-Type"])))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [result (run-tests 'container-mock.diagnostics-test)]
    (when (pos? (+ (:fail result) (:error result))) (System/exit 1))))
