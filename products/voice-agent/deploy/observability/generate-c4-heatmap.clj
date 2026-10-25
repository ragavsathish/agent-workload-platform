(ns generate-c4-heatmap
  (:require [cheshire.core :as json]
            [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file "deploy/observability/c4-dashboard.clj")

(def ^:private evidence
  [["c1-system-context" [["voice_agent" "partial"]]]
   ["c2-container" [["BROWSER" "strong"] ["KNOWLEDGE" "partial"] ["DIAGNOSTICS" "partial"] ["INGRESS" "strong"] ["ROUTER" "strong"]
                    ["EDGE" "strong"] ["BROKER" "partial"] ["PI" "partial"] ["VOICE_VM" "partial"]
                    ["JOURNAL_MCP" "partial"] ["GATEWAY" "partial"] ["TASKS" "observed"] ["OWNER" "partial"]
                    ["OWNER_STORE" "observed"]
                    ["TASK_VM" "partial"] ["WASSETTE" "partial"] ["BUILDER_MANAGER" "strong"]
                    ["BUILDER_VM" "strong"] ["VOICE_DATA" "partial"] ["GITEA" "partial"] ["ARTIFACTS" "partial"]
                    ["OXIGRAPH" "observed"] ["DOCKER_METRICS" "strong"] ["HOST_METRICS" "strong"] ["OTEL" "strong"]
                    ["GRAFANA_MCP" "strong"]]]
   ["c3-browser-client" [["BROWSER" "strong"]]]
   ["c3-journal-knowledge" [["VIEW" "partial"]]]
   ["c3-input-diagnostics" [["DIAGNOSTICS" "partial"]]]
   ["c3-voice-edge" [["EDGE" "strong"]]]
   ["c3-inference-broker" [["BROKER" "partial"]]]
   ["c3-pi-voice-service" [["PI" "partial"]]]
   ["c3-voice-tool-sandbox" [["VM" "partial"]]]
   ["c3-agent-gateway" [["GATEWAY" "partial"]]]
   ["c3-pi-task-worker" [["OWNER" "partial"]]]
   ["c3-image-build-worker" [["WORKER" "weak"]]]
   ["c3-disposable-image-builder" [["MANAGER" "strong"] ["RUNNER" "strong"] ["OTEL" "strong"]]]
   ["c3-task-tool-runtime" [["OWNER" "partial"]]]
   ["c3-host-observability" [["OBS" "strong"]]]
   ["deployment-security" [["EDGE" "strong"] ["GATEWAY" "partial"] ["BROKER" "partial"] ["PI" "partial"]
                            ["VOICE_TOOLS" "partial"] ["OWNER" "partial"] ["WORKER" "partial"]
                            ["OWNER_STORE" "observed"] ["TASK_PI" "weak"] ["TASK_TOOLS" "partial"]
                            ["VOICE_WASSETTE" "partial"] ["TASK_WASSETTE" "partial"] ["BUILDER_MANAGER" "strong"]
                            ["RUNNER" "strong"] ["POSTGRES" "observed"]
                            ["S3" "partial"] ["GITEA" "partial"] ["OXIGRAPH" "observed"] ["DOCKER_METRICS" "strong"]
                            ["HOST_METRICS" "strong"] ["OTEL" "strong"] ["GRAFANA_MCP" "strong"]]]])

(def ^:private activity
  [["c2-container" [["EDGE" ["A" "pipecat-voice-edge"]]
                    ["BROKER" ["B" "pipecat-mlx-inference"]]
                    ["GATEWAY" ["C" "pipecat-agent-gateway"]]
                    ["PI" ["D" "pipecat-pi-voice"]]
                    ["BUILDER_MANAGER" ["F" "pipecat-image-builder"]]
                    ["BUILDER_VM" ["G" "pipecat-gitea-runner"]]]]])

(def ^:private views
  [["c1-system-context" "C1 · System context"]
   ["c2-container" "C2 · Containers"]
   ["c3-browser-client" "C3 · Browser Voice Client"]
   ["c3-journal-knowledge" "C3 · Journal & Knowledge"]
   ["c3-input-diagnostics" "C3 · Input Diagnostics"]
   ["c3-voice-edge" "C3 · Voice Edge"]
   ["c3-inference-broker" "C3 · Inference Broker"]
   ["c3-pi-voice-service" "C3 · Pi Voice Service"]
   ["c3-voice-tool-sandbox" "C3 · Voice Tool Sandbox"]
   ["c3-agent-gateway" "C3 · Agent Gateway"]
   ["c3-pi-task-worker" "C3 · Pi Durable Owner"]
   ["c3-image-build-worker" "C3 · Image Build Orchestration"]
   ["c3-disposable-image-builder" "C3 · Shared Image Builder"]
   ["c3-task-tool-runtime" "C3 · Pi Task Session"]
   ["c3-host-observability" "C3 · Host Observability"]
   ["deployment-security" "Deployment · Security boundaries"]])

(def ^:private evidence-markdown
  (str "## Engineering evidence\n\n"
       "| Executable surface | Line coverage |\n|---|---:|\n"
       "| Flutter client | **63.9%** |\n| Pi Voice Service | **36.4%** |\n"
       "| Gondolin workspace adapter | **53.4%** |\n| Combined Pi agent JavaScript | **40.3%** |\n\n"
       "Build evidence snapshot · 2026-10-16. Other surfaces have test evidence but no consolidated executable-line report.\n\n"
       "## How to read this dashboard\n\n"
       "**C2 fill = telemetry activity:** 🔴 missing or stale for 2 minutes · ⚪ idle · 🔵 low · 🟦 medium · 🟢 high. Activity is volume, not health.\n\n"
       "**C2 border = evidence:** 🟢 strong · 🟠 partial · 🔵 observed · 🔴 weak. All other views use neutral gray backgrounds so the live container trace remains the sole highlight.\n\n"
       "Architecture and evidence remain source-controlled; operations remain live in Grafana. Use the dashboard links for RED product signals and USE resource signals."))

(defn- hex-channels [hex]
  (let [digits (if (= 3 (count hex)) (apply str (mapcat #(repeat 2 %) hex)) hex)]
    (mapv #(Integer/parseInt % 16) (re-seq #"(?i)[0-9a-f]{2}" digits))))

(defn neutralize-diagram [source]
  (if (re-find #"(?m)^\s*C4(?:Context|Container|Component|Dynamic|Deployment)\b" source)
    (let [element-ids (map second
                           (re-seq #"(?m)^\s*(?:Person|Person_Ext|System|System_Ext|SystemDb|SystemDb_Ext|Container|ContainerDb|ContainerQueue|Component)\(\s*([A-Za-z][A-Za-z0-9_-]*)\s*," source))]
      (str (str/trim source) "\n\n%% Grafana node backgrounds are intentionally neutral.\n"
           (str/join "\n" (map #(format "UpdateElementStyle(%s, \"#3f3f46\", \"#f4f4f5\")" %) element-ids)) "\n"))
    (str/replace source #"(?m)^\s*classDef\s+[^\n]+$"
                 (fn [definition]
                   (if-let [[_ raw-fill] (re-find #"(?i)fill:\s*#([0-9a-f]{3}|[0-9a-f]{6})\b" definition)]
                     (let [[red green blue] (hex-channels raw-fill)
                           luminance (+ (* 0.2126 red) (* 0.7152 green) (* 0.0722 blue))
                           fill (if (< luminance 145) "#3f3f46" "#d4d4d8")]
                       (str/replace-first definition #"(?i)fill:\s*#[0-9a-f]{3,8}" (str "fill:" fill)))
                     definition)))))

(defn- evidence-records []
  (for [[diagram elements] evidence
        [element status] elements]
    {:diagram-id diagram :element-id element :status status}))

(defn- activity-records []
  (for [[diagram elements] activity
        [element [ref-id service-name]] elements]
    {:diagram-id diagram :element-id element :ref-id ref-id :service-name service-name}))

(defn- assert-current-elements! [diagrams records]
  (let [sources (into {} (map (juxt :id :mermaid) diagrams))]
    (doseq [{:keys [diagram-id element-id]} records
            :let [source (get sources diagram-id)]
            :when (and source (str/starts-with? source "flowchart"))]
      (let [declared (set (map second
                              (re-seq #"(?m)^\s*(?:subgraph\s+)?([A-Za-z][A-Za-z0-9_]*)\s*(?:\[|\(|\{)"
                                      source)))]
        (when-not (contains? declared element-id)
          (throw (ex-info "C4 heat-map evidence refers to a removed diagram element"
                          {:diagram-id diagram-id :element-id element-id})))))))

(defn build-dashboard []
  (let [architecture (fs/path "docs/architecture")
        diagrams (mapv (fn [[id title]]
                         {:id id
                          :title title
                          :mermaid (neutralize-diagram (slurp (str (fs/path architecture (str id ".mmd")))))
                          :width (if (contains? #{"c1-system-context" "c2-container" "deployment-security"} id) 24 12)
                          :height (if (contains? #{"c2-container" "deployment-security"} id) 22 14)})
                       views)
        input {:options {:dashboard-title "C4 Operational Heat Map"
                         :dashboard-uid "voice-c4-heatmap"
                         :description "Generated from the authoritative Voice Agent Mermaid C4 sources. The C2 container view carries live Prometheus activity overlays; detail views stay neutral gray."
                         :refresh "30s"
                         :time-from "now-15m"
                         :evidence-markdown evidence-markdown}
               :diagrams diagrams
               :evidence (vec (evidence-records))
               :activity (vec (activity-records))}
        _ (assert-current-elements! diagrams (concat (:evidence input) (:activity input)))
        dashboard (c4-dashboard/compile-dashboard input)]
    (when-not (and (= "voice-c4-heatmap" (:uid dashboard))
                   (= (inc (count views)) (count (:panels dashboard))))
      (throw (ex-info "C4 dashboard compiler returned an unexpected dashboard structure" {})))
    dashboard))

(defn -main [& _]
  (let [output (fs/path "deploy/observability/c4-heatmap.json")
        dashboard (build-dashboard)]
    (spit (str output) (str (json/generate-string dashboard {:pretty true}) "\n"))
    (println "Generated" (str output) "with" (count (:panels dashboard)) "panels")))

(when (= *file* (System/getProperty "babashka.file"))
  (-main))
