(ns container-mock.durable
  (:require [cheshire.core :as json]
            [clojure.string :as str])
  (:import [java.io ByteArrayOutputStream]
           [java.time Instant]
           [java.util UUID]
           [java.util.zip ZipEntry ZipOutputStream]))

(def scenarios #{"scratch-success" "direct-submit" "worker-failed" "repository-unavailable"
                 "owner-unavailable" "artifact-missing"})
(def boundaries
  [{:id "DURABLE" :container "Durable Task API" :consumer "Flutter Task Board"
    :method "POST" :path "/api/tasks" :contract "direct submission, result and artifact"}])
(defn initial-state [] {:scenario "scratch-success" :tasks [] :events []})
(defn route? [path]
  (or (contains? #{"/api/tasks" "/__fixture/durable/scenario"
                   "/__fixture/durable/evidence"} path)
      (boolean (re-matches #"/api/tasks/[^/]+" path))
                   (boolean (re-matches #"/api/tasks/[^/]+/(cancel|artifacts/workspace|progress|narration)" path))))
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
(declare transition)
(defn submit-from-session
  "Model the Pi session invoking its submit_agent_task tool at the C2 boundary.

  The test fixture uses an explicit command form so it does not pretend to test
  model intent recognition; it does exercise the session-to-tool-to-owner path."
  [state instruction]
  (transition state {:method "POST" :path "/api/tasks"
                     :body (json/generate-string {:instruction instruction
                                                  :workspace "scratch"})}))
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
      (and (= method "GET") (re-matches #"/api/tasks/([^/]+)" path))
      (let [[_ id] (re-matches #"/api/tasks/([^/]+)" path)
            task (some #(when (= id (:id %)) %) (:tasks state))
            status (if task 200 404)]
        {:state (recorded state method path status)
         :response (if task (reply 200 task) (reply 404 {:detail "Task not found"}))})
      (and (= path "/api/tasks") (= method "POST"))
      (let [instruction (:instruction payload)
            workspace (:workspace payload "scratch")
            valid? (and (string? instruction) (<= 1 (count instruction) 1500)
                        (contains? #{"scratch" "repository"} workspace))
            id (str (UUID/randomUUID))
            unavailable? (or (= "owner-unavailable" (:scenario state))
                             (and (= "repository-unavailable" (:scenario state))
                                  (= "repository" workspace)))
            task-state (if (= "worker-failed" (:scenario state)) "failed" "completed")
            task {:id id :instruction instruction :workspace workspace
                  :status "submitted" :task_id id
                  :created_at (str (Instant/now))}
            task (assoc task :result (if (= task-state "failed")
                                      {:state "failed" :failure {:type "WorkerFailed" :message "Worker exited 1"}}
                                      {:state "completed" :result {:exit_code 0 :artifacts ["workspace"]}}))]
        (cond
          (not valid?)
          {:state (recorded state method path 400)
           :response (reply 400 {:detail "Invalid task submission"})}
          unavailable?
          {:state (recorded state method path 503)
           :response (reply 503 {:detail (if (= "owner-unavailable" (:scenario state))
                                          "Task owner unavailable" "Repository unavailable")})}
          :else
          {:state (-> state (update :tasks #(into [task] %)) (recorded method path 201))
           :response (reply 201 task)}))
      :else
      (let [[_ id action] (re-matches #"/api/tasks/([^/]+)/(cancel|artifacts/workspace|progress|narration)" path)
            task (some #(when (= id (:id %)) %) (:tasks state))
            scenario (:scenario state)
            status (cond
                     (nil? task) 404
                     (and (= action "artifacts/workspace") (= scenario "artifact-missing")) 404
                     (and (= action "artifacts/workspace")
                          (not= "completed" (get-in task [:result :state]))) 404
                     :else 200)
            archive (when (= action "artifacts/workspace") (artifact (:instruction task)))
            updated (cond
                      (not= status 200) task
                      (= action "cancel") (assoc task :status "cancelled")
                      :else task)
            response (cond
                       (not= status 200) (reply status {:detail (case status
                                                                 404 "Task or artifact not found"
                                                                 409 "Task cannot be cancelled"
                                                                 "Task or artifact not found")})
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
