(ns container-mock.pi-voice
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(def scenarios #{"ready" "upstream-unavailable" "turn-error" "malformed-event"})
(def boundaries
  [{:id "PI_VOICE" :container "Pi Voice" :consumer "Inference Broker"
    :method "POST" :path "/v1/turn/stream"
    :contract "bounded Pi delta and error SSE events"}])
(defn initial-state [] {:scenario "ready" :events []})
(defn route? [path]
  (contains? #{"/v1/turn/stream" "/__fixture/pi-voice/scenario"
               "/__fixture/pi-voice/evidence"} path))
(defn- json-response [status payload]
  {:status status :headers {"Content-Type" "application/json"}
   :body (json/generate-string payload)})
(defn- sse [events]
  {:status 200 :headers {"Content-Type" "text/event-stream" "Cache-Control" "no-cache"}
   :body (str/join "" (map #(str "data: " (if (string? %) % (json/generate-string %)) "\n\n") events))})
(defn transition [state {:keys [method path headers body]}]
  (cond
    (= path "/__fixture/pi-voice/scenario")
    (let [scenario (try (:scenario (json/parse-string (or body "") true))
                        (catch Exception _ nil))]
      (if (and (= method "POST") (contains? scenarios scenario))
        {:state {:scenario scenario :events []} :response (json-response 200 {:scenario scenario})}
        {:state state :response (json-response 400 {:detail "Unknown Pi voice scenario"})}))
    (= path "/__fixture/pi-voice/evidence")
    {:state state :response (json-response 200 state)}
    :else
    (let [request (try (json/parse-string (or body "") true) (catch Exception _ nil))
          valid? (and (= method "POST") (= (str "Bearer " (System/getenv "INFERENCE_BROKER_TOKEN"))
                                           (get headers "authorization"))
                      (vector? (:messages request)) (seq (:messages request)))
          scenario (:scenario state)
          response (cond
                     (not valid?) (json-response 400 {:detail "invalid Pi voice stream request"})
                     (= scenario "upstream-unavailable") (json-response 503 {:detail "Pi unavailable"})
                     (= scenario "turn-error") (sse [{:type "delta" :delta "Partial "}
                                                       {:type "error" :detail "Pi turn failed"}])
                     (= scenario "malformed-event") (sse ["{not-json" {:type "delta" :delta "Recovered"}])
                     :else (sse [{:type "delta" :delta "Ready "} {:type "delta" :delta "from Pi."}]))]
      {:state (update state :events conj {:containerId "PI_VOICE" :path path
                                          :scenario scenario :status (:status response)})
       :response response})))
