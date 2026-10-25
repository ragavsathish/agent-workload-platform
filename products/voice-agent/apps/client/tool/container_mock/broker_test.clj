(ns container-mock.broker-test
  (:require [cheshire.core :as json]
            [clojure.test :refer [deftest is run-tests]]
            [container-mock.broker :as broker]))

(def request-body {:model "pi-agent" :stream false
                   :messages [{:role "system" :content "You are Pi"}
                              {:role "user" :content "Hello"}]})
(defn- call [state method token body]
  (broker/transition state {:method method :path "/v1/pi/chat/completions"
                            :headers {"authorization" token}
                            :body (json/generate-string body)}))

(deftest broker-boundary-requires-the-real-request-shape
  (let [state (broker/initial-state)
        accepted (call state "POST" (str "Bearer " broker/token) request-body)]
    (is (= 200 (get-in accepted [:response :status])))
    (is (= "chat.completion" (get-in (json/parse-string (get-in accepted [:response :body]) true)
                                      [:object])))
    (is (= 401 (get-in (call state "POST" "Bearer wrong" request-body) [:response :status])))
    (is (= 400 (get-in (call state "POST" (str "Bearer " broker/token)
                             (assoc request-body :stream true)) [:response :status])))
    (is (= 405 (get-in (call state "GET" (str "Bearer " broker/token) request-body)
                       [:response :status])))))

(deftest broker-fault-scenarios-keep-recorded-requests
  (doseq [[scenario expected]
          [["ready" 200] ["unavailable" 502] ["invalid-response" 200]
           ["empty-response" 200]]]
    (let [selected (broker/transition (broker/initial-state)
                                      {:method "POST" :path "/__fixture/broker/scenario"
                                       :body (json/generate-string {:scenario scenario})})
          result (call (:state selected) "POST" (str "Bearer " broker/token) request-body)]
      (is (= expected (get-in result [:response :status])))
      (is (= scenario (get-in result [:state :events 0 :scenario]))))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [result (run-tests 'container-mock.broker-test)]
    (when (pos? (+ (:fail result) (:error result))) (System/exit 1))))
