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

(deftest durable-c2-session-turn-invokes-task-tool-and-returns-native-task
  (let [fixture (server/start-server {:port 0 :durable-mode true :turn-delay-ms 1})
        client (HttpClient/newHttpClient)
        base (str "http://127.0.0.1:" (:port fixture))
        send (fn [method path payload]
               (let [builder (HttpRequest/newBuilder (URI/create (str base path)))
                     _ (.header builder "Content-Type" "application/json")
                     _ (if (= method "GET") (.GET builder)
                           (.POST builder (HttpRequest$BodyPublishers/ofString
                                           (json/generate-string payload))))
                     request (.build builder)
                     response (.send client request (HttpResponse$BodyHandlers/ofString))]
                 [(.statusCode response) (json/parse-string (.body response) true)]))]
    (try
      (is (= 200 (first (send "POST" "/__fixture/durable/scenario"
                              {:scenario "direct-submit"}))))
      (let [[status response] (send "POST" "/api/pi-message"
                                    {:message "Submit a scratch task: create session-proof.txt containing exactly session-proof followed by a newline."})
            [evidence-status evidence] (send "GET" "/__fixture/durable/evidence" {})]
        (is (= 200 status))
        (is (= 200 evidence-status))
        (is (re-find #"Submitted directly to Pi Durable" (:spoken response)))
        (is (= 1 (count (:tasks evidence))))
        (is (= 201 (get-in evidence [:events 0 :status])))
        (is (= "/api/tasks" (get-in evidence [:events 0 :path]))))
      (finally (server/stop-server! fixture)))))

(deftest c2-mock-shares-journal-state-across-query-owner-route-and-gateway
  (let [entry-id (str (apply str (repeat 32 "a")) ":entry:1")
        other-id (str (apply str (repeat 32 "b")) ":entry:1")
        entry {:id entry-id :kind "idea" :text "Initial note" :createdAt "2026-10-25T08:00:00Z"
               :sourceId "capture-1" :sourceLabel "Voice session" :transcript "Original turn"
               :topics ["Learning"]}
        fixture (server/start-server {:port 0 :c2-entries [entry]})
        client (HttpClient/newHttpClient)
        base (str "http://127.0.0.1:" (:port fixture))
        send (fn [method path body headers]
               (let [builder (HttpRequest/newBuilder (URI/create (str base path)))
                     _ (doseq [[key value] headers] (.header builder key value))
                     request (if (= method "GET") (.GET builder)
                                 (.POST builder (HttpRequest$BodyPublishers/ofString
                                                  (json/generate-string body))))
                     response (.send client (.build request) (HttpResponse$BodyHandlers/ofString))]
                 [(.statusCode response) (json/parse-string (.body response) true)]))]
    (try
      ;; Send raw SPARQL because the browser WASM owns query construction.
      (let [request (-> (HttpRequest/newBuilder (URI/create (str base "/oxigraph/query")))
                        (.header "Content-Type" "application/sparql-query")
                        (.POST (HttpRequest$BodyPublishers/ofString
                                "SELECT * WHERE { GRAPH <urn:awp:digital-twin:graph:journal> { ?s ?p ?o } }"))
                        (.build))
            initial (.send client request (HttpResponse$BodyHandlers/ofString))]
        (is (= 200 (.statusCode initial)))
        (is (= entry-id (get-in (json/parse-string (.body initial) true)
                                [:results :bindings 0 :id :value]))))
      (let [[status saved] (send "POST" (str "/api/knowledge/journal/" entry-id "/feedback")
                                 {:action "edit" :correctedText "Reviewed note" :correctedType "learning"
                                  :correctedTopics ["Learning" "Review"]}
                                 {"Content-Type" "application/json"})]
        (is (= 200 status))
        (is (= entry-id (:entryId saved)))
        (is (re-matches #"[a-f0-9]{32}" (:feedbackId saved))))
      (let [[status state] (send "GET" "/__fixture/c2/evidence" nil {})]
        (is (= 200 status))
        (is (= "Reviewed note" (:text (first (:entries state)))))
        (is (= ["Learning" "Review"] (:topics (first (:entries state))))))
      (let [[status _] (send "POST" (str "/v1/digital-twin/journal/" entry-id "/feedback")
                                   {:identity "owner@example.test" :action "edit" :correctedText "MCP saved note"
                                    :correctedType "decision" :correctedTopics ["Review"]}
                                   {"Content-Type" "application/json"})]
        (is (= 401 status)))
      (let [[status _] (send "POST" (str "/v1/digital-twin/journal/" entry-id "/feedback")
                                   {:identity "owner@example.test" :action "edit" :correctedText "MCP saved note"
                                    :correctedType "decision" :correctedTopics ["Review"]}
                                   {"Content-Type" "application/json"
                                    "Authorization" "Bearer c2-mock-token"})
            [evidence-status evidence] (send "GET" "/__fixture/c2/evidence" nil {})]
        (is (= 200 status))
        (is (= 200 evidence-status))
        (is (= "MCP saved note" (:text (first (:entries evidence)))))
        (is (= ["OXIGRAPH" "EDGE" "GATEWAY"]
               (mapv :containerId (:events evidence)))))
      (let [request (-> (HttpRequest/newBuilder (URI/create (str base "/oxigraph/query")))
                        (.header "Content-Type" "application/sparql-query")
                        (.POST (HttpRequest$BodyPublishers/ofString
                                "SELECT * WHERE { GRAPH <urn:awp:digital-twin:graph:journal> { ?s ?p ?o } }"))
                        (.build))
            latest (.send client request (HttpResponse$BodyHandlers/ofString))]
        (is (= "application/sparql-results+json"
               (.orElse (.firstValue (.headers latest) "Content-Type") "")))
        (is (= "MCP saved note" (get-in (json/parse-string (.body latest) true)
                                       [:results :bindings 0 :text :value]))))
      (let [[status _] (send "POST" (str "/api/knowledge/journal/" entry-id "/assertion-review")
                                   {:ownerAuthored "false" :reason "Not a verified owner turn"}
                                   {"Content-Type" "application/json"})
            [read-status review] (send "GET" (str "/api/knowledge/journal/" entry-id "/assertion-review") nil {})]
        (is (= 200 status))
        (is (= 200 read-status))
        (is (= "Not a verified owner turn" (get-in review [:review :reason]))))
      (let [[status _] (send "POST" (str "/api/knowledge/journal/" other-id "/feedback")
                                   {:action "delete"} {"Content-Type" "application/json"})]
        (is (= 404 status)))
      (finally (server/stop-server! fixture)))))

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
