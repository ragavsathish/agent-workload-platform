(ns container-mock.pi-durable-owner-test
  (:require [cheshire.core :as json]
            [clojure.test :refer [deftest is run-tests]]
            [container-mock.pi-durable-owner :as owner]))

(defn call [state command fields]
  (owner/transition state {:method "POST" :path "/private/task"
                           :headers {"authorization" (str "Bearer " owner/token)}
                           :body (json/generate-string (merge {:id "test" :command command} fields))}))

(def input {:kind "agent-run" :requestId "task-1"
            :params {:workspace "scratch" :instruction "create a file"}})

(deftest owner-boundary-covers-lifecycle-and-faults
  (let [created (call (owner/initial-state) "submit" {:requestId "task-1" :input input})
        duplicate (call (:state created) "submit" {:requestId "task-1" :input input})
        read-back (call (:state duplicate) "get" {:taskId "task-1"})
        batch (call (:state duplicate) "get_many" {:taskIds ["task-1" "missing"]})]
    (is (= "task-1" (get-in (json/parse-string (get-in created [:response :body]) true)
                             [:data :task_id])))
    (is (= 1 (count (get-in duplicate [:state :tasks]))))
    (is (= "completed" (get-in (json/parse-string (get-in read-back [:response :body]) true)
                                 [:data :state])))
    (is (= "completed" (get-in (json/parse-string (get-in batch [:response :body]) true)
                                 [:data :task-1 :state])))
    (is (false? (:success (json/parse-string
                           (get-in (call (:state created) "submit"
                                         {:requestId "task-1" :input (assoc-in input [:params :instruction] "changed")})
                                   [:response :body]) true))))
    (is (= "terminal" (get-in (json/parse-string
                                (get-in (call (:state created) "abort" {:taskId "task-1"})
                                        [:response :body]) true) [:data :disposition]))))
  (let [slow (-> (owner/initial-state) (assoc :scenario "slow"))
        created (call slow "submit" {:requestId "task-1" :input input})
        aborted (call (:state created) "abort" {:taskId "task-1"})
        retried (call (:state aborted) "retry" {:taskId "task-1"})]
    (is (= "cancelled" (get-in aborted [:state :tasks "task-1" :state])))
    (is (= "cancelled" (get-in retried [:state :tasks "task-1" :state]))))
  (let [parked (assoc (owner/initial-state) :scenario "restart-limit")
        created (call parked "submit" {:requestId "task-1" :input input})
        inspected (call (:state created) "inspect" {})
        retried (call (:state created) "retry" {:taskId "task-1"})]
    (is (= "pending" (get-in (json/parse-string
                               (get-in (call (:state created) "get" {:taskId "task-1"})
                                       [:response :body]) true) [:data :state])))
    (is (= "restart_limit" (get-in (json/parse-string
                                     (get-in inspected [:response :body]) true)
                                    [:data :tasks 0 :state :reason])))
    (is (= "completed" (get-in retried [:state :tasks "task-1" :state]))))
  (doseq [[scenario expected] [["task-failure" "failed"] ["owner-unavailable" nil]]]
    (let [result (call (assoc (owner/initial-state) :scenario scenario)
                       "submit" {:requestId "task-1" :input input})]
      (is (= expected (get-in result [:state :tasks "task-1" :state])))))
  (is (= 401 (get-in (owner/transition (owner/initial-state)
                                       {:method "POST" :path "/private/task" :headers {}
                                        :body (json/generate-string {:id "x" :command "inspect"})})
                      [:response :status]))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [result (run-tests 'container-mock.pi-durable-owner-test)]
    (when (pos? (+ (:fail result) (:error result))) (System/exit 1))))
