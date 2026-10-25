(ns container-mock.pi-durable-owner
  (:require [cheshire.core :as json]))

(def token "c2-pi-owner-token-000000000000000000000")
(def scenarios #{"success" "task-failure" "owner-unavailable" "slow" "restart-limit"})
(def kinds #{"agent-run" "song-lyrics" "song-render" "digital-twin-journal" "digital-twin-classify"})
(def boundaries
  [{:id "PI_DURABLE_OWNER" :container "Pi Durable Owner" :consumer "Agent Gateway"
    :method "POST" :path "/private/task"
    :contract "native task submit, result, abort, retry and idempotency"}])
(defn initial-state [] {:scenario "success" :tasks {} :events []})
(defn route? [path]
  (contains? #{"/private/task" "/__fixture/pi-owner/scenario"
               "/__fixture/pi-owner/evidence"} path))
(defn- response [status value]
  {:status status :headers {"Content-Type" "application/json"}
   :body (json/generate-string value)})
(defn- record-event [state command status]
  (update state :events conj {:containerId "PI_DURABLE_OWNER" :command command
                              :status status :scenario (:scenario state)}))
(defn transition [state {:keys [method path headers body]}]
  (let [payload (try (json/parse-string (or body "") true) (catch Exception _ nil))]
    (cond
      (= path "/__fixture/pi-owner/scenario")
      (if (and (= method "POST") (contains? scenarios (:scenario payload)))
        {:state (assoc (initial-state) :scenario (:scenario payload))
         :response (response 200 {:scenario (:scenario payload)})}
        {:state state :response (response 400 {:detail "Unknown owner scenario"})})
      (= path "/__fixture/pi-owner/evidence")
      {:state state :response (response 200 state)}
      (not= method "POST")
      {:state state :response (response 405 {:detail "Method not allowed"})}
      (not= (str "Bearer " token) (get headers "authorization"))
      {:state state :response (response 401 {:detail "Invalid owner token"})}
      (= "owner-unavailable" (:scenario state))
      {:state (record-event state (:command payload) 503)
       :response (response 503 {:detail "Owner unavailable"})}
      :else
      (let [{:keys [command requestId input taskId taskIds id]} payload
            existing (get-in state [:tasks taskId])
            submitted (get-in state [:tasks requestId])
            invalid? (or (not (string? id))
                         (not (contains? #{"submit" "get" "get_many" "abort" "retry" "inspect"} command))
                         (and (= command "get_many")
                              (or (not (vector? taskIds)) (> (count taskIds) 100)
                                  (not-every? string? taskIds)))
                         (and (= command "submit")
                              (or (not (string? requestId))
                                  (not (contains? kinds (:kind input)))
                                  (not= requestId (:requestId input))
                                  (not (map? (:params input))))))
            result (cond
                     invalid? {:success false :error "invalid owner request"}
                     (= command "submit")
                     (if (and submitted (not= (:input submitted) input))
                       {:success false :error "request ID was already used with different input"}
                       {:success true :data {:task_id requestId}})
                     (= command "get") {:success true :data (when existing
                                                              (-> (select-keys existing [:state :result :failure])
                                                                  (update :state #(if (= % "parked") "pending" %))))}
                     (= command "get_many")
                     {:success true :data (into {} (map (fn [task-id]
                       [task-id (when-let [task (get-in state [:tasks task-id])]
                         (-> (select-keys task [:state :result :failure])
                             (update :state #(if (= % "parked") "pending" %))))]) taskIds))}
                     (= command "abort") (if existing
                                             {:success true :data {:disposition (if (#{"completed" "failed" "cancelled"} (:state existing))
                                                                                    "terminal" "marked")}}
                                             {:success false :error "task not found"})
                     (= command "retry") (if existing
                                             {:success true :data {:retried true}}
                                             {:success false :error "task not found"})
                     :else {:success true :data {:tasks (mapv (fn [[task-id task]]
                                                                {:id task-id
                                                                 :state (if (= "parked" (:state task))
                                                                          {:kind "blocked" :reason "restart_limit"}
                                                                          {:kind (:state task)})})
                                                              (:tasks state))}})
            task-state (if (= "task-failure" (:scenario state)) "failed"
                         (cond (= "slow" (:scenario state)) "running"
                               (= "restart-limit" (:scenario state)) "parked"
                               :else "completed"))
            task-result (case (:kind input)
                          "agent-run" {:exit_code 0 :response {:text "Mock Pi completed."
                                                                 :spoken "Mock Pi completed."
                                                                 :presentation nil :resourceUri nil}}
                          "song-lyrics" {:manifest {:title "Mock song" :lyrics "Verse"}}
                          "song-render" {:artifacts {:audio "s3://agent-artifacts/mock.wav"}}
                          {:mode (get-in input [:params :mode]) :decision {:outcome "written"}})
            updated (cond
                      (and (= command "submit") (:success result) (nil? submitted))
                      (assoc-in state [:tasks requestId] {:input input :state task-state
                                                          :result (when (= task-state "completed") task-result)
                                                          :failure (when (= task-state "failed") "mock task failed")})
                      (and (= command "abort") (:success result) (= "running" (:state existing)))
                      (assoc-in state [:tasks taskId :state] "cancelled")
                      (and (= command "retry") (:success result) (= "parked" (:state existing)))
                      (assoc-in state [:tasks taskId] (assoc existing :state "completed" :result
                                                           {:exit_code 0 :response {:text "Retried" :spoken "Retried"}} :failure nil))
                      :else state)]
        {:state (record-event updated command 200)
         :response (response 200 (assoc result :id id))}))))
