#!/usr/bin/env bb
(ns patrol-mock-inference-broker
  (:require [cheshire.core :as json]
            [patrol-http :as http]
            [clojure.string :as str]))

(defn start-server [{:keys [port host token]
                     :or {port 9443 host "0.0.0.0"}}]
  (when-not (and (string? token) (>= (count token) 32))
    (throw (ex-info "PATROL_BROKER_TOKEN must contain at least 32 characters" {})))
  (let [instance (http/start! {:host host :port port
    :handler
    (fn [{:keys [method path headers body]}]
      (let [json-response (fn [status value]
                            {:status status :headers {"content-type" "application/json" "cache-control" "no-store"}
                             :body (json/generate-string value)})
            payload (try (if (str/blank? body) {} (json/parse-string body true))
                         (catch Exception _ ::invalid))]
        (cond
          (= path "/health") (json-response 200 {:status "ok" :mode "deterministic-mock"})
          (not (str/starts-with? path "/v1/")) (json-response 404 {:error "not found"})
          (not= (str "Bearer " token) (get headers "authorization")) (json-response 401 {:error "unauthorized"})
          (= ::invalid payload) (json-response 400 {:error "invalid JSON"})
          (and (= method "GET") (= path "/v1/models"))
          (json-response 200 {:object "list" :data [{:id "patrol-mock" :object "model" :owned_by "local"}]})
          (and (= method "POST") (str/ends-with? path "/chat/completions"))
          (json-response 200 {:id "chatcmpl-patrol-mock" :object "chat.completion" :created 0
                              :model (or (:model payload) "patrol-mock")
                              :choices [{:index 0 :message {:role "assistant" :content "Deterministic Patrol mock response."} :finish_reason "stop"}]
                              :usage {:prompt_tokens 0 :completion_tokens 0 :total_tokens 0}})
          (and (= method "POST") (= path "/v1/audio/transcriptions"))
          (json-response 200 {:text "Deterministic Patrol mock transcript."})
          (and (= method "GET") (= path "/v1/pi/transcript")) (json-response 200 {:entries [] :transcript []})
          (and (= method "GET") (str/starts-with? path "/v1/pi/sessions")) (json-response 200 {:sessions []})
          (and (= method "POST") (str/starts-with? path "/v1/pi/")) (json-response 200 {:status "ok" :mock true})
          :else (json-response 501 {:error "endpoint is not implemented by the Patrol mock" :path path}))))})]
    (println (str "Patrol inference mock listening on " (:port instance)))
    instance))

(defn stop-server! [instance] (http/stop! instance))
(defn -main [& _]
  (let [instance (start-server {:port (Long/parseLong (or (System/getenv "PATROL_BROKER_PORT") "9443"))
                                :host (or (System/getenv "PATROL_BROKER_HOST") "0.0.0.0")
                                :token (System/getenv "PATROL_BROKER_TOKEN")})]
    (.addShutdownHook (Runtime/getRuntime) (Thread. #(stop-server! instance)))
    @(promise)))
(when (= *file* (System/getProperty "babashka.file")) (-main))
