#!/usr/bin/env bb
(ns patrol-fixture-server
  (:require [cheshire.core :as json]
            [clojure.string :as str]
            [container-mock.broker :as broker]
            [container-mock.diagnostics :as diagnostics]
            [container-mock.durable :as durable]
            [container-mock.journal :as c2]
            [container-mock.pi-voice :as pi-voice]
            [patrol-fixture-domain :as domain]
            [patrol-fixture-scenes :as scenes]
            [patrol-fixture-static :as static]
            [patrol-http :as http])
  (:import [java.nio ByteBuffer ByteOrder]
           [java.net URI]
           [java.net.http HttpClient HttpClient$Version HttpRequest HttpRequest$BodyPublishers HttpResponse$BodyHandlers]
           [java.time Duration]
           [java.nio.file Files Paths]
           [java.util UUID]))

(def ^:private cors {"Access-Control-Allow-Headers" "Cache-Control, Content-Type"
                     "Access-Control-Allow-Methods" "GET, POST, OPTIONS"
                     "Access-Control-Allow-Origin" "*" "Cache-Control" "no-store"
                     "Content-Type" "application/json"})
(defn- json-response ([status body] {:status status :headers cors :body (json/generate-string body)}))
(defn- transition-response [transition success-status]
  (if (= "Err" (:type transition))
    (let [type (get-in transition [:error :type])]
      (json-response (cond (contains? #{"SessionNotFound" "TaskNotFound"} type) 404
                           (= type "TurnAlreadyActive") 409 :else 400) {:detail type}))
    (json-response success-status (:value transition))))
(defn- wav []
  (let [samples 800 b (doto (ByteBuffer/allocate 1644) (.order ByteOrder/LITTLE_ENDIAN))]
    (.put b (.getBytes "RIFF" "US-ASCII")) (.putInt b 1636)
    (.put b (.getBytes "WAVEfmt " "US-ASCII")) (.putInt b 16) (.putShort b (short 1))
    (.putShort b (short 1)) (.putInt b 8000) (.putInt b 16000) (.putShort b (short 2))
    (.putShort b (short 16)) (.put b (.getBytes "data" "US-ASCII")) (.putInt b (* samples 2))
    (.array b)))

(defn- live-turn [base-url traceparent message]
  (let [target (URI/create (str (str/replace base-url #"/$" "") "/api/pi-message"))]
    (when-not (and (= "http" (.getScheme target))
                   (= "127.0.0.1" (.getHost target))
                   (re-matches #"00-[0-9a-f]{32}-[0-9a-f]{16}-01" traceparent))
      (throw (ex-info "Invalid Patrol live edge configuration" {})))
    (let [request (-> (HttpRequest/newBuilder target)
                      (.timeout (Duration/ofSeconds 90))
                      (.header "Content-Type" "application/json")
                      (.header "Origin" "http://127.0.0.1:7860")
                      (.header "X-Voice-Local-Ingress" "1")
                      (.header "traceparent" traceparent)
                      (.POST (HttpRequest$BodyPublishers/ofString
                              (json/generate-string {:message message})))
                      (.build))
          client (-> (HttpClient/newBuilder) (.version HttpClient$Version/HTTP_1_1) (.build))
          response (.send client request (HttpResponse$BodyHandlers/ofString))]
      (if (= 200 (.statusCode response))
        (json/parse-string (.body response) true)
        (let [detail (try (:detail (json/parse-string (.body response) true))
                          (catch Exception _ nil))]
          (throw (ex-info "Live edge turn failed"
                          {:status (.statusCode response)
                           :detail (when (string? detail) (subs detail 0 (min 200 (count detail))))})))))))

(defn start-server
  ([] (start-server {}))
  ([{:keys [port host name nonce static-root knowledge-root diagnostics-root ready-file turn-delay-ms speech-delay-ms
            live-edge-url live-traceparent c2-entries durable-mode]
     :or {port 54321 host "127.0.0.1" name "voice-agent-patrol" turn-delay-ms 1800 speech-delay-ms 3000}}]
   (let [nonce (or nonce (str (UUID/randomUUID)))
         state (atom (domain/create-initial-fixture-state)) pending (atom {}) events (atom []) lock (Object.)
         c2-state (atom (c2/initial-state (or c2-entries [])))
         diagnostics-state (atom (diagnostics/initial-state))
         broker-state (atom (broker/initial-state))
         pi-voice-state (atom (pi-voice/initial-state))
         durable-state (atom (durable/initial-state))
         route-impl (fn [{:keys [method path headers body]}]
                 (let [body-map #(if (str/blank? body) {} (json/parse-string body true))
                       transition! (fn [transition status]
                                     (reset! state (:state transition))
                                     (transition-response transition status))]
                   (cond
                     (= method "OPTIONS") {:status 204 :headers cors}
                     (and (= method "GET") (= path "/health")) (json-response 200 {:ok true :fixture name :nonce nonce})
                     (and (= method "GET") (= path "/__fixture/c2/boundaries"))
                     (json-response 200 {:boundaries (into [] (concat c2/boundaries diagnostics/boundaries broker/boundaries pi-voice/boundaries durable/boundaries))})
                     (and (= method "GET") (= path "/__fixture/evidence"))
                     (json-response 200 {:fixture name :nonce nonce :events @events
                                         :activeSessionId (:activeSessionId @state)
                                         :tasks (:tasks @state)
                                         :activeTurn (:activeTurn @state)
                                         :c2Events (:events @c2-state)})
                     (c2/route? path)
                     (locking lock
                       (let [{:keys [state response]} (c2/transition @c2-state
                                                                       {:method method :path path
                                                                        :headers headers :body body})]
                         (reset! c2-state state)
                         response))
                     (diagnostics/route? path)
                     (locking lock
                       (let [{:keys [state response]} (diagnostics/transition @diagnostics-state
                                                                              {:method method :path path :body body})]
                         (reset! diagnostics-state state)
                         response))
                     (broker/route? path)
                     (locking lock
                       (let [{:keys [state response]} (broker/transition @broker-state
                                                                         {:method method :path path
                                                                          :headers headers :body body})]
                         (reset! broker-state state)
                         response))
                     (pi-voice/route? path)
                     (locking lock
                       (let [{:keys [state response]} (pi-voice/transition @pi-voice-state
                                                                            {:method method :path path
                                                                             :headers headers :body body})]
                         (reset! pi-voice-state state)
                         response))
                     (and durable-mode (durable/route? path))
                     (locking lock
                       (let [{:keys [state response]} (durable/transition @durable-state
                                                                           {:method method :path path :body body})]
                         (reset! durable-state state)
                         response))
                     (and (= method "GET") (= path "/api/mock/scenes")) (json-response 200 {:scenes (scenes/fixture-scene-names)})
                     (and (= method "POST") (= path "/api/pi-speech"))
                     (do (Thread/sleep (long speech-delay-ms))
                         {:status 200 :body (wav) :headers (assoc cors "Content-Type" "audio/wav")})
                     (and (= method "GET") (= path "/api/pi-context")) (json-response 200 (domain/context-usage @state))
                     (and (= method "POST") (= path "/api/pi-context/compact"))
                     (locking lock (transition! (domain/compact-context @state) 200))
                     (and (= method "GET") (= path "/api/pi-transcript")) (json-response 200 (domain/transcript-snapshot @state))
                     (and (= method "GET") (= path "/api/pi-sessions")) (json-response 200 (domain/session-summaries @state))
                     (and (= method "POST") (= path "/api/pi-sessions/new"))
                     (locking lock (transition! (domain/start-new-session @state {:now #(str (java.time.Instant/now))}) 201))
                     (and (= method "POST") (re-matches #"/api/pi-sessions/[^/]+/resume" path))
                     (let [[_ id] (re-matches #"/api/pi-sessions/([^/]+)/resume" path)]
                       (locking lock (transition! (domain/resume-session @state id {:now #(str (java.time.Instant/now))}) 200)))
                     (and (= method "GET") (re-matches #"/api/pi-sessions/[^/]+" path))
                     (let [[_ id] (re-matches #"/api/pi-sessions/([^/]+)" path)]
                       (transition-response (domain/historical-transcript @state id) 200))
                     (and (= method "POST") (= path "/api/pi-message"))
                     (let [message (:message (body-map))
                           started (locking lock
                                     (let [result (domain/begin-turn @state message {:now #(System/currentTimeMillis)})]
                                       (reset! state (:state result)) result))]
                       (if (= "Err" (:type started))
                         (transition-response started 200)
                         (let [{:keys [id]} (:value started) gate (promise)]
                           (swap! pending assoc id gate)
                           (let [live-response (when live-edge-url
                                                 (try (live-turn live-edge-url live-traceparent message)
                                                      (catch Exception error
                                                        (println "Patrol live edge request failed:"
                                                                 (.getMessage error) (select-keys (ex-data error) [:status :detail]))
                                                        ::failed)))
                                 session-instruction (when (and durable-mode (nil? live-edge-url))
                                                       (second (re-matches
                                                                #"(?is)^submit a scratch task:\s*(.+)$"
                                                                (str message))))
                                 session-tool-result (when session-instruction
                                                       (let [result (durable/submit-from-session
                                                                     @durable-state session-instruction)]
                                                         (reset! durable-state (:state result))
                                                         (:response result)))
                                 completed? (and (not= ::failed live-response)
                                                 (= ::timeout (deref gate (if live-edge-url 0 (long turn-delay-ms)) ::timeout)))
                                 value (locking lock
                                         (swap! pending dissoc id)
                                         (if completed?
                                           (if live-edge-url
                                             (do (swap! state #(domain/complete-turn-with-response % id live-response))
                                                 live-response)
                                             (if session-tool-result
                                               (let [task (when (= 201 (:status session-tool-result))
                                                            (json/parse-string (:body session-tool-result) true))
                                                     response {:spoken (if task
                                                                         (str "Submitted directly to Pi Durable as task " (:id task) ".")
                                                                         "I could not submit the task to Pi Durable.")
                                                               :presentation {:kind "flow" :title "Durable task submitted"
                                                                              :nodes [{:id "session" :label "Pi session"}
                                                                                      {:id "owner" :label "Pi Durable"}]
                                                                              :edges [{:from "session" :to "owner"}]}}]
                                                 (swap! state #(domain/complete-turn-with-response % id response))
                                                 response)
                                               (do (swap! state #(domain/complete-turn % id (get headers "origin")))
                                                   (domain/completed-turn-response message (get headers "origin")))))
                                           (domain/interrupted-turn-response)))]
                             (json-response (if (= ::failed live-response) 502 200) value)))))
                     (and (= method "POST") (= path "/api/pi-turn/abort"))
                     (let [transition (locking lock
                                        (let [result (domain/abort-active-turn @state)]
                                          (reset! state (:state result)) result))
                           turn-id (get-in transition [:value :turnId])]
                       (when (and turn-id (get @pending turn-id)) (deliver (get @pending turn-id) :interrupted))
                       (json-response 200 {:status "stopped"}))
                     (and (= method "GET") (= path "/api/tasks")) (json-response 200 (:tasks @state))
                     (and (= method "POST") (= path "/api/tasks"))
                     (locking lock (transition! (domain/create-task @state (:instruction (body-map)) {:now #(str (java.time.Instant/now))}) 201))
                     (and (= method "POST") (re-matches #"/api/tasks/[^/]+/cancel" path))
                     (let [[_ id] (re-matches #"/api/tasks/([^/]+)/cancel" path)
                           status "cancelled"]
                       (locking lock (transition! (domain/change-task-status @state id status) 200)))
                     (and knowledge-root (= method "GET") (str/starts-with? path "/knowledge/"))
                     (or (static/serve-static knowledge-root (subs path (count "/knowledge")))
                         (json-response 404 {:detail "knowledge asset not found"}))
                     (and diagnostics-root (= method "GET") (str/starts-with? path "/diagnostics/"))
                     (or (static/serve-static diagnostics-root (subs path (count "/diagnostics")))
                         (json-response 404 {:detail "diagnostics asset not found"}))
                     (and static-root (= method "GET") (not (str/starts-with? path "/api/")))
                     (or (static/serve-static static-root path) (json-response 404 {:detail "fixture route not found"}))
                     :else (json-response 404 {:detail "fixture route not found"}))))
         route (fn [{:keys [method path] :as request}]
                 (let [response (route-impl request)]
                   (when (and (= method "POST") (str/starts-with? path "/api/"))
                     (swap! events conj {:method method :path path :status (:status response)}))
                   response))
         _ (when (and static-root (not (Files/isRegularFile (Paths/get (str static-root) (into-array String ["index.html"])) (make-array java.nio.file.LinkOption 0))))
             (throw (ex-info "Static root is missing index.html; build the client first" {:root static-root})))
         _ (when (and knowledge-root (not (Files/isRegularFile (Paths/get (str knowledge-root) (into-array String ["index.html"])) (make-array java.nio.file.LinkOption 0))))
             (throw (ex-info "Knowledge root is missing index.html; build the knowledge app first" {:root knowledge-root})))
         _ (when (and diagnostics-root (not (Files/isRegularFile (Paths/get (str diagnostics-root) (into-array String ["index.html"])) (make-array java.nio.file.LinkOption 0))))
             (throw (ex-info "Diagnostics root is missing index.html; build the diagnostics app first" {:root diagnostics-root})))
         instance (http/start! {:host host :port port :handler route})
         ready {:fixture name :nonce nonce :port (:port instance)}]
     (when ready-file
       (let [path (Paths/get (str ready-file) (make-array String 0))]
         (when-let [parent (.getParent path)] (Files/createDirectories parent (make-array java.nio.file.attribute.FileAttribute 0)))
         (spit (str path) (str (json/generate-string ready) "\n"))))
     (println (str name " listening on http://" host ":" (:port instance)))
     (assoc instance :state state :pending pending :events events :c2-state c2-state
            :diagnostics-state diagnostics-state :broker-state broker-state
            :pi-voice-state pi-voice-state :durable-state durable-state))))

(defn stop-server! [instance] (http/stop! instance))
(defn -main [& _]
  (let [instance (start-server {:port (Long/parseLong (or (System/getenv "PATROL_FIXTURE_PORT") "54321"))
                                :host (or (System/getenv "PATROL_FIXTURE_HOST") "127.0.0.1")
                                :name (or (System/getenv "PATROL_FIXTURE_NAME") "voice-agent-patrol")
                                :nonce (or (System/getenv "PATROL_FIXTURE_NONCE") (str (UUID/randomUUID)))
                                :static-root (System/getenv "PATROL_FIXTURE_STATIC_ROOT")
                                :knowledge-root (System/getenv "PATROL_KNOWLEDGE_STATIC_ROOT")
                                :diagnostics-root (System/getenv "PATROL_DIAGNOSTICS_STATIC_ROOT")
                                :ready-file (System/getenv "PATROL_FIXTURE_READY_FILE")
                                :live-edge-url (not-empty (System/getenv "PATROL_LIVE_EDGE_URL"))
                                :live-traceparent (System/getenv "PATROL_LIVE_TRACEPARENT")
                                :durable-mode (= "true" (System/getenv "PATROL_DURABLE_C2"))
                                :c2-entries (when-let [path (not-empty (System/getenv "PATROL_C2_SCENARIO_FILE"))]
                                              (json/parse-string (slurp path) true))})]
    (.addShutdownHook (Runtime/getRuntime) (Thread. #(stop-server! instance)))
    @(promise)))
(when (= *file* (System/getProperty "babashka.file")) (-main))
