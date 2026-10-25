(ns container-mock.durable
  (:require [cheshire.core :as json]
            [clojure.string :as str])
  (:import [java.io ByteArrayOutputStream]
           [java.time Instant]
           [java.util UUID]
           [java.util.zip ZipEntry ZipOutputStream]))

(def scenarios #{"scratch-success" "worker-failed" "repository-unavailable" "approval-conflict"})
(def boundaries
  [{:id "DURABLE" :container "Durable Task API" :consumer "Flutter Task Board"
    :method "POST" :path "/api/tasks" :contract "proposal, approval, result and artifact"}])
(defn initial-state [] {:scenario "scratch-success" :tasks [] :events []})
(defn route? [path]
  (or (contains? #{"/api/tasks" "/__fixture/durable/scenario"
                   "/__fixture/durable/evidence"} path)
      (boolean (re-matches #"/api/tasks/[^/]+/(approve|cancel|artifacts/workspace|progress|narration)" path))))
(defn- reply [status payload]
  {:status status :headers {"Content-Type" "application/json" "Cache-Control" "no-store"}
   :body (json/generate-string payload)})
(defn- artifact [instruction]
  (let [[_ filename marker] (re-find #"create ([A-Za-z0-9_-]+\.txt) containing exactly ([A-Za-z0-9_-]+)" instruction)
        output (ByteArrayOutputStream.)]
    (when (and filename marker)
      (with-open [zip (ZipOutputStream. output)]
        (.putNextEntry zip (ZipEntry. filename))
        (.write zip (.getBytes (str marker "\n") "UTF-8"))
        (.closeEntry zip))
      (.toByteArray output))))
(defn- recorded [state method path status]
  (update state :events conj {:containerId "DURABLE" :method method :path path
                              :scenario (:scenario state) :status status}))
(defn transition [state {:keys [method path body]}]
  (let [payload (try (json/parse-string (or body "") true) (catch Exception _ {}))]
    (cond
      (= path "/__fixture/durable/scenario")
      (let [scenario (:scenario payload)]
        (if (and (= method "POST") (contains? scenarios scenario))
          {:state {:scenario scenario :tasks [] :events []}
           :response (reply 200 {:scenario scenario})}
          {:state state :response (reply 400 {:detail "Unknown durable scenario"})}))
      (= path "/__fixture/durable/evidence")
      {:state state :response (reply 200 state)}
      (and (= path "/api/tasks") (= method "GET"))
      {:state (recorded state method path 200) :response (reply 200 (:tasks state))}
      (and (= path "/api/tasks") (= method "POST"))
      (let [instruction (:instruction payload)
            workspace (:workspace payload "scratch")
            valid? (and (string? instruction) (<= 1 (count instruction) 1500)
                        (contains? #{"scratch" "repository"} workspace))
            task {:id (str (UUID/randomUUID)) :instruction instruction :workspace workspace
                  :plan_hash (str (UUID/randomUUID)) :status "pending"
                  :created_at (str (Instant/now))}]
        (if valid?
          {:state (-> state (update :tasks #(into [task] %)) (recorded method path 201))
           :response (reply 201 task)}
          {:state (recorded state method path 400)
           :response (reply 400 {:detail "Invalid task proposal"})}))
      :else
      (let [[_ id action] (re-matches #"/api/tasks/([^/]+)/(approve|cancel|artifacts/workspace|progress|narration)" path)
            task (some #(when (= id (:id %)) %) (:tasks state))
            scenario (:scenario state)
            status (cond
                     (nil? task) 404
                     (and (= action "approve") (not= "pending" (:status task))) 409
                     (and (= action "approve") (= scenario "approval-conflict")) 409
                     (and (= action "approve") (= scenario "repository-unavailable")
                          (= "repository" (:workspace task))) 503
                     (and (= action "artifacts/workspace")
                          (not= "completed" (get-in task [:result :state]))) 404
                     :else 200)
            archive (when (= action "artifacts/workspace") (artifact (:instruction task)))
            completed (assoc task :status "approved" :task_id (str (UUID/randomUUID))
                             :result (if (= scenario "worker-failed")
                                       {:state "failed" :failure {:type "WorkerFailed" :message "Worker exited 1"}}
                                       {:state "completed" :result {:exit_code 0 :artifacts ["workspace"]}}))
            updated (cond
                      (not= status 200) task
                      (= action "approve") completed
                      (= action "cancel") (assoc task :status "cancelled")
                      :else task)
            response (cond
                       (not= status 200) (reply status {:detail (case status
                                                                 404 "Task or artifact not found"
                                                                 409 "Task cannot be approved"
                                                                 "Repository unavailable")})
                       (= action "artifacts/workspace")
                       (if archive
                         {:status 200 :headers {"Content-Type" "application/zip"
                                                "Content-Disposition" "attachment; filename=workspace.zip"}
                          :body archive}
                         (reply 404 {:detail "Workspace artifact not available"}))
                       (= action "progress") (reply 200 [])
                       (= action "narration") (reply 200 {:spoken "The mock worker completed."})
                       :else (reply 200 updated))]
        {:state (-> state
                    (update :tasks #(mapv (fn [item] (if (= id (:id item)) updated item)) %))
                    (recorded method path (:status response)))
         :response response}))))
