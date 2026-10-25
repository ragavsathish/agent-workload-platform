(ns container-mock.broker
  (:require [cheshire.core :as json]))

(def token "c2-mock-broker-token-0000000000000000")
(def scenarios #{"ready" "unavailable" "invalid-response" "empty-response"})
(def boundaries
  [{:id "BROKER" :container "Inference Broker" :consumer "Voice Edge"
    :method "POST" :path "/v1/pi/chat/completions"
    :contract "authenticated non-streaming Pi completion"}])

(defn initial-state [] {:scenario "ready" :events []})
(defn route? [path]
  (contains? #{"/__fixture/broker/scenario" "/__fixture/broker/evidence"
               "/v1/pi/chat/completions"} path))
(defn- response [status body]
  {:status status :headers {"Content-Type" "application/json" "Cache-Control" "no-store"}
   :body (json/generate-string body)})
(defn- record [state method path status]
  (update state :events conj {:containerId "BROKER" :method method :path path
                              :status status :scenario (:scenario state)}))

(defn- valid-request? [body]
  (and (= "pi-agent" (:model body))
       (= false (:stream body))
       (vector? (:messages body))
       (<= 1 (count (:messages body)) 64)
       (every? #(and (contains? #{"system" "developer" "user" "assistant"} (:role %))
                     (string? (:content %))) (:messages body))
       (not (seq (:tools body)))))

(defn transition [state {:keys [method path headers body]}]
  (cond
    (= path "/__fixture/broker/scenario")
    (if (= method "POST")
      (let [scenario (try (:scenario (json/parse-string (or body "") true))
                          (catch Exception _ nil))]
        (if (contains? scenarios scenario)
          {:state {:scenario scenario :events []} :response (response 200 {:scenario scenario})}
          {:state state :response (response 400 {:detail "Unknown broker scenario"})}))
      {:state state :response (response 405 {:detail "Method not allowed"})})

    (= path "/__fixture/broker/evidence")
    {:state state :response (if (= method "GET") (response 200 state)
                            (response 405 {:detail "Method not allowed"}))}

    :else
    (let [parsed (try (json/parse-string (or body "") true) (catch Exception _ nil))
          scenario (:scenario state)
          completion (case scenario
                       "invalid-response" {:id "chatcmpl-c2-invalid" :choices []}
                       "empty-response" {:id "chatcmpl-c2-empty"
                                         :choices [{:index 0 :message {:role "assistant" :content ""}}]}
                       {:id "chatcmpl-c2-ready" :object "chat.completion"
                        :created 1792915200 :model "pi-agent"
                        :choices [{:index 0 :message {:role "assistant"
                                                      :content (json/generate-string
                                                                {:spoken "Ready from the broker mock."
                                                                 :presentation {:kind "status" :title "Pi response"
                                                                                :nodes [{:id "result" :label "Ready"}]
                                                                                :edges []}})}
                                   :finish_reason "stop"}]
                        :usage {:prompt_tokens 0 :completion_tokens 0 :total_tokens 0}})
          [status payload] (cond
                             (not= method "POST") [405 {:detail "Method not allowed"}]
                             (not= (str "Bearer " token) (get headers "authorization"))
                             [401 {:detail "invalid broker credential"}]
                             (not (valid-request? parsed)) [400 {:detail "invalid Pi chat request"}]
                             (= scenario "unavailable") [502 {:detail "Pi voice service is unavailable"}]
                             :else [200 completion])]
      {:state (record state method path status) :response (response status payload)})))
