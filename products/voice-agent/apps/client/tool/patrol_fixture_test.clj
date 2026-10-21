(ns patrol-fixture-test
  (:require [cheshire.core :as json]
            [clojure.test :refer [deftest is testing]]
            [patrol-fixture-domain :as domain]
            [patrol-fixture-scenes :as scenes]
            [patrol-fixture-server :as server]
            [patrol-fixture-static :as static]
            [patrol-http :as http])
  (:import [java.net URI]
           [java.net.http HttpClient HttpRequest HttpRequest$BodyPublishers HttpResponse$BodyHandlers]))

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

(deftest live-turn-completes-transcript-with-edge-response
  (let [started (domain/begin-turn (domain/create-initial-fixture-state)
                                   "Patrol live edge health journey" {:now (constantly 1)})
        response {:spoken "Deterministic Patrol mock response."
                  :presentation {:kind "flow" :title "Done"}}
        completed (domain/complete-turn-with-response
                   (:state started) (get-in started [:value :id]) response)]
    (is (= response (json/parse-string (:text (last (:entries completed))) true)))
    (is (= "completed" (:status (last (:entries completed)))))))

(deftest live-relay-forwards-valid-json-and-trace-context
  (let [received (atom nil)
        response {:spoken "Deterministic Patrol mock response."
                  :presentation {:kind "flow" :title "Done" :nodes [] :edges []}}
        edge (http/start! {:port 0 :handler
                           (fn [request]
                             (reset! received request)
                             {:status 200 :headers {"Content-Type" "application/json"}
                              :body (json/generate-string response)})})
        traceparent "00-1234567890abcdef1234567890abcdef-1234567890abcdef-01"
        fixture (server/start-server {:port 0
                                      :live-edge-url (str "http://127.0.0.1:" (:port edge))
                                      :live-traceparent traceparent})]
    (try
      (let [request (-> (HttpRequest/newBuilder (URI/create
                                                (str "http://127.0.0.1:" (:port fixture) "/api/pi-message")))
                        (.header "Content-Type" "application/json")
                        (.POST (HttpRequest$BodyPublishers/ofString
                                (json/generate-string {:message "Patrol live edge health journey"})))
                        (.build))
            result (.send (HttpClient/newHttpClient) request (HttpResponse$BodyHandlers/ofString))]
        (is (= 200 (.statusCode result)))
        (is (= response (json/parse-string (.body result) true)))
        (is (= {:message "Patrol live edge health journey"}
               (json/parse-string (:body @received) true)))
        (is (= traceparent (get-in @received [:headers "traceparent"])))
        (is (= "1" (get-in @received [:headers "x-voice-local-ingress"])))
        (is (nil? (get-in @received [:headers "upgrade"]))))
      (finally
        (server/stop-server! fixture)
        (http/stop! edge)))))

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
