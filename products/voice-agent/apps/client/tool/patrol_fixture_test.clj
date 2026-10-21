(ns patrol-fixture-test
  (:require [clojure.test :refer [deftest is testing]]
            [patrol-fixture-domain :as domain]
            [patrol-fixture-scenes :as scenes]
            [patrol-fixture-static :as static]))

(deftest scenes-drive-the-synthetic-turn-contract
  (is (= ["mermaid" "slides" "excalidraw" "trace" "journal"] (scenes/fixture-scene-names)))
  (doseq [[prompt expected] [["Show a Mermaid diagram" "flow"] ["Show Marp slides" "slides"]
                             ["Show editable Excalidraw" "excalidraw"]
                             ["Show the Playwright trace" "playwright-trace-viewer"]
                             ["Review the journal annotation" "journal-review"]]]
    (let [started (domain/begin-turn (domain/create-initial-fixture-state) prompt {:now (constantly 1)})
          response (domain/completed-turn-response prompt "http://localhost:5000")
          completed (domain/complete-turn (:state started) (get-in started [:value :id]) "http://localhost:5000")]
      (is (= expected (get-in response [:presentation :kind])))
      (is (= "Ok" (:type started)))
      (is (= "completed" (:status (last (:entries completed))))))))

(deftest fixture-state-transitions-cover-session-and-task-actions
  (let [initial (domain/create-initial-fixture-state)
        compacted (domain/compact-context initial)
        fresh (domain/start-new-session initial {:now #(str "now")})
        session-id (get-in fresh [:value :id])
        resumed (domain/resume-session (:state fresh) "fixture-live" {:now #(str "now")})
        task (domain/create-task initial "Review" {:now #(str "now")})]
    (is (= 7.5 (get-in compacted [:value :percent])))
    (is (= false (:canCompact (domain/context-usage (:state fresh)))))
    (is (= session-id (:activeSessionId (:state fresh))))
    (is (= "fixture-live" (get-in resumed [:value :id])))
    (is (= "pending" (get-in task [:value :status])))))

(deftest static-paths-cannot-escape-the-build-root
  (is (= "/tmp/client/index.html" (str (static/static-path "/tmp/client" "/"))))
  (is (= "/tmp/client/marp/index.html" (str (static/static-path "/tmp/client" "/marp/index.html"))))
  (is (nil? (static/static-path "/tmp/client" "/../private")))
  (is (nil? (static/static-path "/tmp/client" "/%2e%2e/private")))
  (is (nil? (static/static-path "/tmp/client" "/bad%00name"))))

(defn -main [& _]
  (let [result (clojure.test/run-tests 'patrol-fixture-test)]
    (when (pos? (+ (:fail result) (:error result))) (System/exit 1))))

(when (= *file* (System/getProperty "babashka.file")) (-main))
