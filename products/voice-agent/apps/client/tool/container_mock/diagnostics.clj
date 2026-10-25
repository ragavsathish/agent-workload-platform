(ns container-mock.diagnostics
  (:require [cheshire.core :as json])
  (:import [java.nio ByteBuffer ByteOrder]))

(def scenarios #{"ready" "empty" "unavailable" "truncated" "metrics-unavailable"})
(def session-id "11111111-1111-4111-8111-111111111111")
(def boundaries
  [{:id "EDGE" :container "Voice Edge" :consumer "Input Diagnostics"
    :method "GET" :path "/api/audio-diagnostics" :contract "bounded replay list"}
   {:id "EDGE" :container "Voice Edge" :consumer "Input Diagnostics"
    :method "GET" :path "/api/audio-diagnostics/live" :contract "live input envelope"}
   {:id "EDGE" :container "Voice Edge" :consumer "Input Diagnostics"
    :method "GET" :path "/api/audio-diagnostics/{sessionId}/metrics" :contract "session metrics"}
   {:id "EDGE" :container "Voice Edge" :consumer "Input Diagnostics"
    :method "GET" :path "/api/audio-diagnostics/{sessionId}/{variant}.wav" :contract "bounded replay audio"}])

(defn initial-state [] {:scenario "ready" :events []})
(defn route? [path]
  (or (= path "/__fixture/diagnostics/scenario")
      (= path "/__fixture/diagnostics/evidence")
      (= path "/api/audio-diagnostics")
      (boolean (re-matches #"/api/audio-diagnostics/[^/]+(?:/[^/]+)?" path))))

(defn- json-response [status body]
  {:status status :headers {"Content-Type" "application/json" "Cache-Control" "no-store"}
   :body (json/generate-string body)})

(defn- wav []
  (let [samples 800 b (doto (ByteBuffer/allocate 1644) (.order ByteOrder/LITTLE_ENDIAN))]
    (.put b (.getBytes "RIFF" "US-ASCII")) (.putInt b 1636)
    (.put b (.getBytes "WAVEfmt " "US-ASCII")) (.putInt b 16) (.putShort b (short 1))
    (.putShort b (short 1)) (.putInt b 8000) (.putInt b 16000) (.putShort b (short 2))
    (.putShort b (short 16)) (.put b (.getBytes "data" "US-ASCII")) (.putInt b (* samples 2))
    (.array b)))

(defn- session [scenario]
  {:id session-id :startedAt "2026-10-25T08:00:00Z"
   :completedAt "2026-10-25T08:00:04Z" :durationSeconds 4 :sampleRate 8000
   :selectedFilter "rnnoise" :droppedChunks (if (= scenario "truncated") 2 0)
   :truncated (= scenario "truncated") :variants ["raw" "rnnoise"]
   :metricsAvailable true})
(def ^:private metrics
  {:version 2
   :points [{:timeSeconds 0 :rawDbfs -45 :rnnoiseDbfs -50
             :rnnoiseSuppressionDb 5 :rnnoiseLatencyMs 2.1}
            {:timeSeconds 1 :rawDbfs -20 :rnnoiseDbfs -24
             :rnnoiseSuppressionDb 4 :rnnoiseLatencyMs 2.3}]
   :vadSamples [{:timeSeconds 0 :confidence 0.1 :volume 0.1}
                {:timeSeconds 1 :confidence 0.9 :volume 0.8}]
   :events [{:timeSeconds 1 :kind "vad_speech_started"}]})

(defn- reply [state method path response]
  (let [event {:containerId "EDGE" :method method :path path :status (:status response)
               :scenario (:scenario state)}]
    {:state (update state :events conj event) :response response}))

(defn transition [state {:keys [method path body]}]
  (cond
    (= path "/__fixture/diagnostics/scenario")
    (if (= method "POST")
      (let [requested (try (:scenario (json/parse-string (or body "") true))
                           (catch Exception _ nil))]
        (if (contains? scenarios requested)
          {:state {:scenario requested :events []}
           :response (json-response 200 {:scenario requested})}
          {:state state :response (json-response 400 {:detail "Unknown diagnostics scenario"})}))
      {:state state :response (json-response 405 {:detail "Method not allowed"})})

    (= path "/__fixture/diagnostics/evidence")
    {:state state :response (if (= method "GET") (json-response 200 state)
                            (json-response 405 {:detail "Method not allowed"}))}

    (not= method "GET") (reply state method path (json-response 405 {:detail "Method not allowed"}))
    (= path "/api/audio-diagnostics/live")
    (reply state method path (json-response 200 {:active false :point nil :waveform []}))
    (= path "/api/audio-diagnostics")
    (reply state method path
           (if (= "unavailable" (:scenario state))
             (json-response 503 {:detail "Diagnostic store unavailable"})
             (json-response 200 {:sessions (if (= "empty" (:scenario state)) []
                                            [(session (:scenario state))])})))
    (= path (str "/api/audio-diagnostics/" session-id "/metrics"))
    (reply state method path
           (if (= "metrics-unavailable" (:scenario state))
             (json-response 503 {:detail "Metrics unavailable"})
             (json-response 200 metrics)))
    (re-matches (re-pattern (str "/api/audio-diagnostics/" session-id "/(raw|rnnoise)\\.wav")) path)
    (reply state method path {:status 200 :headers {"Content-Type" "audio/wav" "Cache-Control" "no-store"}
                              :body (wav)})
    :else (reply state method path (json-response 404 {:detail "Replay not found"}))))
