(ns patrol-fixture-domain
  (:require [cheshire.core :as json]
            [clojure.string :as str]
            [patrol-fixture-scenes :as scenes])
  (:import [java.time Instant]))

(defn- instant-ms [value] (.toEpochMilli (Instant/parse value)))
(defn- ok [state value] {:type "Ok" :state state :value value})
(defn- err [state error] {:type "Err" :state state :error error})

(defn create-initial-fixture-state []
  {:revision 1 :activeSessionId "fixture-live" :sessionSequence 1 :taskSequence 1 :freshSession false
   :context {:tokens 1200 :contextWindow 8000 :percent 15 :estimated false :canCompact true}
   :entries (vec
             (concat
              (for [index (range 198)]
                {:id (str "fixture-history-" index)
                 :timestamp (+ (instant-ms "2026-10-15T08:00:00Z") index)
                 :role (if (even? index) "user" "assistant")
                 :text (str "Earlier fixture turn " (inc index)) :status "completed"})
              [{:id "fixture-tool" :timestamp (instant-ms "2026-10-16T07:59:59Z")
                :role "tool" :text "read_workspace" :status "completed"}
               {:id "fixture-slides" :timestamp (instant-ms "2026-10-16T07:59:59.500Z") :role "assistant"
                :text (json/generate-string
                       {:spoken "Requested slides ready."
                        :presentation {:kind "slides" :title "Voice slides"
                                       :markdown (str/join "\n"
                                                                      ["---" "marp: true" "---" "# Voice slides" ""
                                                                       "Rendered through the Flutter MCP App host." "" "---" ""
                                                                       "# Voice path" "" "```mermaid" "flowchart LR"
                                                                       "Browser --> Pi" "```"])}})}
               {:id "fixture-assistant" :timestamp (instant-ms "2026-10-16T08:00:00Z") :role "assistant"
                :text (json/generate-string
                       {:spoken "Ready from the HTTP fixture."
                        :presentation {:kind "flow" :title "Voice path"
                                       :nodes [{:id "browser" :label "Browser"} {:id "pi" :label "Pi"}]
                                       :edges [{:from "browser" :to "pi"}]}})}]))
   :tasks [{:id "fixture-task" :instruction "Review the fixture deployment" :workspace "/workspace"
            :plan_hash "fixture-plan" :status "submitted" :created_at "2026-10-16T08:00:00Z"}]
   :historicalSessions
   {"fixture-history" {:title "Release review" :updatedAt "2026-10-15T18:30:00Z"
                        :entries [{:id "history-user" :timestamp (instant-ms "2026-10-15T18:29:00Z")
                                   :role "user" :text "How did the release go?"}
                                  {:id "history-assistant" :timestamp (instant-ms "2026-10-15T18:30:00Z")
                                   :role "assistant" :text "The release completed successfully." :status "completed"}]}}
   :activeTurn nil})

(defn context-usage [state]
  (if (:freshSession state)
    {:tokens nil :contextWindow nil :percent nil :estimated false :canCompact false}
    (:context state)))

(defn compact-context [state]
  (let [context {:tokens 600 :contextWindow 8000 :percent 7.5 :estimated false :canCompact false}]
    (ok (assoc state :context context) context)))

(defn transcript-snapshot [state] {:revision (:revision state) :entries (:entries state)})

(defn session-summaries [state]
  {:sessions (into [{:id (:activeSessionId state) :title "Voice orchestrator"
                     :updatedAt "2026-10-16T08:00:00Z" :messageCount (count (:entries state)) :active true}]
                   (for [[id session] (:historicalSessions state)]
                     {:id id :title (:title session) :updatedAt (:updatedAt session)
                      :messageCount (count (:entries session)) :active false}))})

(defn historical-transcript [state session-id]
  (if-let [session (get-in state [:historicalSessions session-id])]
    (ok state {:revision 1 :entries (:entries session)})
    (err state {:type "SessionNotFound" :sessionId session-id})))

(defn start-new-session [state {:keys [now]}]
  (let [next-sequence (inc (:sessionSequence state))
        active-session-id (str "fixture-live-" next-sequence)
        history (assoc (:historicalSessions state) (:activeSessionId state)
                       {:title "Previous voice session" :updatedAt (now) :entries (:entries state)})
        next-state (-> state
                       (assoc :revision (inc (:revision state)) :activeSessionId active-session-id
                              :sessionSequence next-sequence :freshSession true
                              :context {:tokens nil :contextWindow nil :percent nil :estimated false :canCompact false}
                              :entries [] :historicalSessions history :activeTurn nil))]
    (ok next-state {:id active-session-id})))

(defn resume-session [state session-id {:keys [now]}]
  (if-let [resumed (get-in state [:historicalSessions session-id])]
    (let [remaining (dissoc (:historicalSessions state) session-id)
          history (assoc remaining (:activeSessionId state)
                         {:title "Previous voice session" :updatedAt (now) :entries (:entries state)})
          next-state (-> state
                         (assoc :revision (inc (:revision state)) :activeSessionId session-id
                                :freshSession false
                                :context {:tokens 1200 :contextWindow 8000 :percent 15 :estimated false :canCompact true}
                                :entries (:entries resumed) :historicalSessions history :activeTurn nil))]
      (ok next-state {:id session-id}))
    (err state {:type "SessionNotFound" :sessionId session-id})))

(defn begin-turn [state message {:keys [now]}]
  (if-let [active (:activeTurn state)]
    (err state {:type "TurnAlreadyActive" :turnId (:id active)})
    (let [revision (inc (:revision state))
          turn-id (str "fixture-turn-" revision)
          assistant-id (str "fixture-assistant-" revision)
          entries (conj (:entries state)
                        {:id (str "fixture-user-" revision) :timestamp (now) :role "user" :text message}
                        {:id assistant-id :timestamp (now) :role "assistant"
                         :text "Inspecting the fixture…" :status "running"})
          active-turn {:id turn-id :assistantId assistant-id :message message}]
      (ok (assoc state :revision revision :freshSession false :entries entries :activeTurn active-turn)
          active-turn))))

(defn- replace-assistant [entries assistant-id change]
  (mapv #(if (= assistant-id (:id %)) (merge % change) %) entries))

(defn complete-turn-with-response [state turn-id response]
  (if (not= turn-id (get-in state [:activeTurn :id]))
    state
    (-> state
        (update :revision inc)
        (update :entries replace-assistant (get-in state [:activeTurn :assistantId])
                {:text (json/generate-string response)
                 :status "completed"})
        (assoc :activeTurn nil))))

(defn complete-turn [state turn-id origin]
  (complete-turn-with-response
   state turn-id (scenes/response-for-fixture-message
                  (get-in state [:activeTurn :message]) origin)))

(defn abort-active-turn [state]
  (if-let [turn (:activeTurn state)]
    (ok (-> state
            (update :revision inc)
            (update :entries replace-assistant (:assistantId turn) {:status "completed"})
            (assoc :activeTurn nil))
        {:turnId (:id turn)})
    (ok state {:turnId nil})))

(defn completed-turn-response [message origin]
  (scenes/response-for-fixture-message message origin))

(defn interrupted-turn-response []
  {:spoken "Response stopped."
   :presentation {:kind "flow" :title "Stopped"
                  :nodes [{:id "request" :label "Request"} {:id "stopped" :label "Stopped"}]
                  :edges [{:from "request" :to "stopped"}]}})

(defn create-task [state instruction {:keys [now]}]
  (let [sequence (inc (:taskSequence state))
        task {:id (str "fixture-task-" sequence) :instruction instruction :workspace "/workspace"
              :plan_hash (str "fixture-plan-" sequence) :status "pending" :created_at (now)}]
    (ok (-> state (assoc :taskSequence sequence) (update :tasks #(into [task] %))) task)))

(defn change-task-status [state task-id status]
  (if-let [task (some #(when (= task-id (:id %)) %) (:tasks state))]
    (let [updated (assoc task :status status)]
      (ok (update state :tasks #(mapv (fn [candidate] (if (= task-id (:id candidate)) updated candidate)) %))
          updated))
    (err state {:type "TaskNotFound" :taskId task-id})))
