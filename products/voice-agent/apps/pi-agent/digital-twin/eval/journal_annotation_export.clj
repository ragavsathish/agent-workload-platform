#!/usr/bin/env bb
(ns journal-annotation-export
  (:require [cheshire.core :as json]
            [clojure.string :as str])
  (:import [java.net URI]
           [java.net.http HttpClient HttpRequest HttpRequest$BodyPublishers HttpResponse$BodyHandlers]
           [java.nio.charset StandardCharsets]
           [java.nio.file Files Paths StandardOpenOption]
           [java.nio.file.attribute PosixFilePermission FileAttribute]
           [java.security MessageDigest]
           [java.time LocalDate ZoneOffset]
           [java.time.format DateTimeFormatter]))

(def query
  (str "PREFIX schema: <https://schema.org/>\n\n"
       "SELECT ?capture ?transcript ?entry ?predictedType ?predictedText ?topic WHERE {\n"
       "  GRAPH <urn:awp:digital-twin:graph:journal> {\n"
       "    ?capture a schema:Message ; schema:text ?transcript .\n"
       "    OPTIONAL {\n"
       "      ?entry a schema:CreativeWork ;\n"
       "        schema:isBasedOn ?capture ;\n"
       "        schema:additionalType ?predictedType ;\n"
       "        schema:text ?predictedText .\n"
       "      OPTIONAL { ?entry schema:keywords ?topic }\n"
       "    }\n"
       "  }\n"
       "}\n"
       "ORDER BY ?capture ?entry ?topic\n"))

(defn parse-args [argv]
  (loop [args (seq argv) options {:query-url "http://127.0.0.1:7878/query" :limit 40}]
    (if-let [arg (first args)]
      (cond
        (= arg "--") (recur (next args) options)
        (contains? #{"--output" "--query-url" "--limit"} arg)
        (let [value (second args)]
          (when (or (nil? value) (str/starts-with? value "--"))
            (throw (ex-info (str arg " requires a value") {})))
          (case arg
            "--output" (recur (nnext args) (assoc options :output value))
            "--query-url" (recur (nnext args) (assoc options :query-url value))
            "--limit" (let [limit (try (Long/parseLong value) (catch Exception _ nil))]
                        (when-not (and limit (<= 1 limit 500))
                          (throw (ex-info "--limit must be an integer between 1 and 500" {})))
                        (recur (nnext args) (assoc options :limit limit)))))
        (contains? #{"--help" "-h"} arg) (recur (next args) (assoc options :help true))
        :else (throw (ex-info (str "unknown argument: " arg) {})))
      options)))

(defn usage []
  (str "Usage: bb journal_annotation_export.clj --output PRIVATE.json [options]\n\n"
       "Exports a stratified, pending HITL queue from the private journal graph.\n"
       "The result is not gold data until a human completes the review fields.\n\n"
       "Options:\n"
       "  --query-url URL   Oxigraph SPARQL endpoint (default http://127.0.0.1:7878/query)\n"
       "  --limit N         Maximum captures to export (default 40)\n"))

(defn bindings [payload]
  (let [rows (get-in payload [:results :bindings])]
    (when-not (sequential? rows)
      (throw (ex-info "Oxigraph returned invalid SPARQL results" {})))
    (mapv (fn [binding]
            (into {} (keep (fn [[key cell]]
                             (when (string? (:value cell)) [key (:value cell)]))) binding)) rows)))

(defn group-captures [rows]
  (let [{:keys [order captures]}
        (reduce (fn [{:keys [order captures] :as acc} row]
                  (let [capture-id (:capture row)]
                    (if-not capture-id acc
                      (let [new? (not (contains? captures capture-id))
                            capture (get captures capture-id {:capture capture-id :transcript (:transcript row)
                                                              :predicted-entries {} :predicted-order []})
                            capture (if (:entry row)
                                      (let [entry-id (:entry row)
                                            new-entry? (not (contains? (:predicted-entries capture) entry-id))
                                            entry (get-in capture [:predicted-entries entry-id]
                                                          {:type (:predictedType row) :text (:predictedText row) :topics []})
                                            entry (if (and (:topic row) (not (some #{(:topic row)} (:topics entry))))
                                                    (update entry :topics conj (:topic row)) entry)]
                                        (-> capture
                                            (assoc-in [:predicted-entries entry-id] entry)
                                            (cond-> new-entry? (update :predicted-order conj entry-id))))
                                      capture)]
                        {:order (cond-> order new? (conj capture-id))
                         :captures (assoc captures capture-id capture)}))))
                {:order [] :captures {}} rows)]
    (mapv (fn [capture-id]
            (let [capture (get captures capture-id)]
              {:capture capture-id
               :transcript (:transcript capture)
               :predicted-entries (mapv #(get-in capture [:predicted-entries %]) (:predicted-order capture))}))
          order)))

(defn stable-rank [value]
  (let [bytes (.digest (MessageDigest/getInstance "SHA-256") (.getBytes (str value) StandardCharsets/UTF_8))]
    (apply str (map #(format "%02x" (bit-and (int %) 0xff)) bytes))))

(defn stratified-sample [captures limit]
  (let [buckets (->> captures
                     (group-by (fn [capture]
                                 (let [types (->> (:predicted-entries capture) (map :type) distinct sort)]
                                   (or (first types) "empty"))))
                     (map (fn [[key bucket]] [key (sort-by #(stable-rank (:capture %)) bucket)]))
                     (sort-by first))
        target (min limit (count captures))]
    (loop [remaining buckets selected []]
      (if (or (>= (count selected) target) (empty? remaining))
        (vec (take target selected))
        (let [round (keep (fn [[_ bucket]] (first bucket)) remaining)
              next-remaining (keep (fn [[key bucket]] (when (next bucket) [key (next bucket)])) remaining)]
          (recur (seq next-remaining) (into selected round)))))))

(defn private-case [capture]
  (let [id (str "journal-" (subs (stable-rank (:capture capture)) 0 20))]
    {:id id :semanticFamilyId id :split "development" :sourceKind "production_journal"
     :errorSlice "unassigned" :annotationStatus "pending" :transcript (:transcript capture)
     :predictedEntries (:predicted-entries capture) :expectedEntries []}))

(defn output-document [captures selected date]
  {:formatVersion 1 :datasetId (str "journal-review-" date)
   :privacyReview {:status "pending" :reviewedAt nil}
   :instructions ["Review transcript privacy and redact secrets before setting privacyReview.status to passed."
                  "Treat predictedEntries as suggestions only; do not copy them without owner review."
                  "Set expectedEntries to reviewed durable entries with exact contiguous evidenceQuote values, or [] for an explicit reviewed empty case."
                  "Set annotationStatus to reviewed or adjudicated, assign an errorSlice, and cluster paraphrases under one semanticFamilyId."
                  "Keep semantic families in only one split; reserve locked_holdout for a single promotion evaluation."]
   :population {:captures (count captures)
                :capturesWithEntries (count (filter #(seq (:predicted-entries %)) captures))
                :capturesWithoutEntries (count (filter #(empty? (:predicted-entries %)) captures))
                :selected (count selected)}
   :cases (mapv private-case selected)})

(defn query-bindings [query-url]
  (let [client (-> (HttpClient/newBuilder) (.connectTimeout (java.time.Duration/ofSeconds 10)) .build)
        request (-> (HttpRequest/newBuilder (URI/create query-url))
                    (.header "accept" "application/sparql-results+json")
                    (.header "content-type" "application/sparql-query")
                    (.POST (HttpRequest$BodyPublishers/ofString query)) .build)
        response (.send client request (HttpResponse$BodyHandlers/ofString))]
    (when-not (<= 200 (.statusCode response) 299)
      (throw (ex-info (str "Oxigraph query failed: " (.statusCode response)) {})))
    (bindings (json/parse-string (.body response) true))))

(def ^:private private-dir-permissions
  (doto (java.util.HashSet.)
    (.add PosixFilePermission/OWNER_READ)
    (.add PosixFilePermission/OWNER_WRITE)
    (.add PosixFilePermission/OWNER_EXECUTE)))
(def ^:private private-file-permissions
  (doto (java.util.HashSet.)
    (.add PosixFilePermission/OWNER_READ)
    (.add PosixFilePermission/OWNER_WRITE)))

(defn write-private! [output-path content]
  (let [path (.toAbsolutePath (.normalize (Paths/get (str output-path) (make-array String 0))))
        parent (.getParent path)]
    (Files/createDirectories parent (into-array FileAttribute [(java.nio.file.attribute.PosixFilePermissions/asFileAttribute private-dir-permissions)]))
    (Files/createFile path (into-array FileAttribute [(java.nio.file.attribute.PosixFilePermissions/asFileAttribute private-file-permissions)]))
    (try
      (Files/write path (.getBytes content StandardCharsets/UTF_8) (into-array StandardOpenOption [StandardOpenOption/WRITE]))
      (finally (Files/setPosixFilePermissions path private-file-permissions)))
    path))

(defn export! [{:keys [query-url limit output]}]
  (let [captures (group-captures (query-bindings query-url))
        selected (stratified-sample captures limit)
        date (.format (DateTimeFormatter/ofPattern "yyyy-MM-dd") (LocalDate/now ZoneOffset/UTC))
        document (output-document captures selected date)
        path (write-private! output (str (json/generate-string document {:pretty true}) "\n"))]
    {:output (str path) :population (:population document) :status "pending-human-review"}))

(defn -main [& argv]
  (try
    (let [options (parse-args argv)]
      (if (:help options)
        (println (usage))
        (do
          (when-not (:output options) (throw (ex-info (usage) {})))
          (println (json/generate-string (export! options) {:pretty true})))))
    (catch Exception error
      (binding [*out* *err*] (println (.getMessage error)))
      (System/exit 1))))

(when (= *file* (System/getProperty "babashka.file")) (apply -main *command-line-args*))
