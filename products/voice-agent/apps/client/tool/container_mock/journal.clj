(ns container-mock.journal
  (:require [cheshire.core :as json]
            [clojure.string :as str])
  (:import [java.net URLDecoder]))

(def journal-graphs ["urn:pk:digital-twin:graph:journal" "urn:awp:digital-twin:graph:journal"])
(def ^:private entry-path #"^/(?:api/knowledge|v1/digital-twin)/journal/([^/]+)/(feedback|assertion-review)$")
(def ^:private kinds #{"thought" "idea" "question" "decision" "goal" "learning"})
(defn- bounded-string? [value maximum]
  (and (string? value) (<= 1 (count value) maximum)))
(defn- valid-entry? [{:keys [id kind text createdAt sourceId sourceLabel transcript topics]}]
  (and (string? id) (re-matches #"[a-f0-9]{32}:entry:[1-9][0-9]*" id)
       (contains? kinds kind)
       (bounded-string? text 1000) (bounded-string? createdAt 80)
       (bounded-string? sourceId 200) (bounded-string? sourceLabel 200)
       (bounded-string? transcript 12000)
       (vector? topics) (<= 1 (count topics) 12)
       (every? #(bounded-string? % 80) topics)))

;; These are C2 container IDs, not names inferred from page text.
(def boundaries
  [{:id "OXIGRAPH" :container "Knowledge Graph Store" :consumer "Journal & Knowledge"
    :method "POST" :path "/oxigraph/query" :contract "SPARQL SELECT results"}
   {:id "EDGE" :container "Voice Edge" :consumer "Journal & Knowledge"
    :method "POST" :path "/api/knowledge/journal/{entryId}/feedback" :contract "owner review command"}
   {:id "EDGE" :container "Voice Edge" :consumer "Journal & Knowledge"
    :method "GET/POST" :path "/api/knowledge/journal/{entryId}/assertion-review" :contract "owner assertion review"}
   {:id "GATEWAY" :container "Agent Gateway" :consumer "Journal Review MCP"
    :method "POST" :path "/v1/digital-twin/journal/{entryId}/feedback" :contract "authenticated correction"}])

(defn initial-state [entries]
  (let [ids (mapv :id entries)]
    (when (or (> (count ids) 200)
              (not= (count ids) (count (set ids)))
              (not-every? valid-entry? entries))
      (throw (ex-info "C2 scenario requires up to 200 valid, unique journal entries" {})))
    {:entries (into {} (map (juxt :id identity) entries))
     :order ids :assertionReviews {} :feedback [] :events [] :sequence 0}))

(defn route? [path]
  (or (= path "/oxigraph/query")
      (= path "/__fixture/c2/boundaries")
      (= path "/__fixture/c2/evidence")
      (boolean (re-matches entry-path path))))

(defn- response [status body content-type]
  {:status status :headers {"Content-Type" content-type "Cache-Control" "no-store"}
   :body (json/generate-string body)})

(defn- result
  ([state status body] (result state status body "application/json"))
  ([state status body content-type]
   {:state state :response (response status body content-type)}))

(defn- record-event [state container method path entry-id status]
  (update state :events conj {:containerId container :method method :path path
                              :entryId entry-id :status status}))

(defn- literal [value] {:type "literal" :value (str value)})

(defn- binding [entry topic]
  {:id (literal (:id entry)) :kind (literal (:kind entry)) :text (literal (:text entry))
   :createdAt (literal (:createdAt entry)) :sourceId (literal (:sourceId entry))
   :sourceLabel (literal (:sourceLabel entry)) :transcript (literal (:transcript entry))
   :topic (literal topic)})

(defn- query-response [state {:keys [method path body headers]}]
  (if (or (not= method "POST")
          (not (str/includes? (get headers "content-type" "") "application/sparql-query"))
          (not (some #(str/includes? (or body "") (str "<" % ">")) journal-graphs))
          (not (re-find #"(?i)\bSELECT\b" (or body ""))))
    (result state 400 {:detail "Only the journal SELECT contract is supported"})
    (let [graph-query? (str/includes? body "SELECT ?from ?fromKind")
          bindings (if graph-query? [] (vec (mapcat (fn [id]
                                 (let [entry (get-in state [:entries id])]
                                   (for [topic (:topics entry)] (binding entry topic))))
                               (:order state))))
          updated (record-event state "OXIGRAPH" method path nil 200)]
      (result updated 200 {:head {:vars (if graph-query? ["from" "to" "relation"]
                                    ["id" "kind" "text" "createdAt" "sourceId"
                                     "sourceLabel" "transcript" "topic"])}
                           :results {:bindings bindings}} "application/sparql-results+json"))))

(defn- decode-entry-id [encoded]
  (URLDecoder/decode encoded "UTF-8"))

(defn- valid-correction? [body]
  (and (= "edit" (:action body))
       (bounded-string? (:correctedText body) 1000)
       (contains? kinds (:correctedType body))
       (vector? (:correctedTopics body))
       (<= (count (:correctedTopics body)) 12)
       (every? #(bounded-string? % 80) (:correctedTopics body))))

(defn- feedback-response [state {:keys [method path headers]} entry-id body gateway?]
  (cond
    (not= method "POST") (result state 405 {:detail "Method not allowed"})
    (and gateway? (not= "Bearer c2-mock-token" (get headers "authorization")))
    (result state 401 {:detail "Mock gateway token required"})
    (and gateway? (str/blank? (:identity body)))
    (result state 400 {:detail "Gateway owner identity required"})
    (not (contains? (:entries state) entry-id)) (result state 404 {:detail "Journal entry not found"})
    (and (not (valid-correction? body)) (not= "delete" (:action body)))
    (result state 400 {:detail "Invalid journal feedback"})
    :else
    (let [sequence (inc (:sequence state))
          feedback-id (format "%032x" sequence)
          deleted? (= "delete" (:action body))
          updated (-> state
                      (assoc :sequence sequence)
                      (update :feedback conj {:id feedback-id :entryId entry-id :action (:action body)})
                      (cond-> deleted? (update :entries dissoc entry-id)
                              deleted? (update :order #(vec (remove #{entry-id} %)))
                              (not deleted?) (update-in [:entries entry-id]
                                                    assoc :text (:correctedText body)
                                                    :kind (:correctedType body)
                                                    :topics (:correctedTopics body)))
                      (record-event (if gateway? "GATEWAY" "EDGE") method path entry-id 200))]
      (result updated 200 {:entryId entry-id :feedbackId feedback-id}))))

(defn- assertion-response [state {:keys [method path]} entry-id body]
  (cond
    (not (contains? (:entries state) entry-id)) (result state 404 {:detail "Journal entry not found"})
    (= method "GET") (result state 200 {:review (get-in state [:assertionReviews entry-id])})
    (= method "POST")
    (if (and (contains? #{"true" "false" true false} (:ownerAuthored body))
             (string? (:reason body)))
      (let [updated (-> state
                        (assoc-in [:assertionReviews entry-id] body)
                        (record-event "EDGE" method path entry-id 200))]
        (result updated 200 {:reviewId (str "c2-review-" entry-id)}))
      (result state 400 {:detail "Invalid assertion review"}))
    :else (result state 405 {:detail "Method not allowed"})))

(defn transition [state {:keys [method path body] :as request}]
  (try
    (cond
      (= path "/__fixture/c2/boundaries")
      (if (= method "GET") (result state 200 {:boundaries boundaries})
          (result state 405 {:detail "Method not allowed"}))
      (= path "/__fixture/c2/evidence")
      (if (= method "GET")
        (result state 200 (assoc state :entries (mapv #(get-in state [:entries %]) (:order state))))
          (result state 405 {:detail "Method not allowed"}))
      (= path "/oxigraph/query") (query-response state request)
      :else
      (let [[_ encoded-id operation] (re-matches entry-path path)
            entry-id (decode-entry-id encoded-id)
            parsed (if (str/blank? body) {} (json/parse-string body true))
            gateway? (str/starts-with? path "/v1/")]
        (if (= operation "feedback")
          (feedback-response state request entry-id parsed gateway?)
          (assertion-response state request entry-id parsed))))
    (catch Exception _ (result state 400 {:detail "Invalid mock request"}))))
