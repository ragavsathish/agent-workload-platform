(ns patrol-fixture-scenes
  (:require [clojure.string :as str])
  (:import [java.net URI]))

(def ^:private scenes
  [{:name "mermaid" :match ["mermaid" "diagram"]
    :spoken "Here is the browser-to-agent path as a diagram."
    :presentation {:kind "flow" :title "Browser to agent"
                    :nodes [{:id "browser" :label "Browser"} {:id "agent" :label "Agent"}]
                    :edges [{:from "browser" :to "agent" :label "MCP App"}]}}
   {:name "slides" :match ["slides" "marp"]
    :spoken "These slides explain the local development path."
    :presentation {:kind "slides" :title "Local development"
                    :markdown (str/join "\n" ["---" "marp: true" "---" "# Local development" ""
                                              "Flutter Web hosts the MCP App." "" "---" "# No host dependency" ""
                                              "Synthetic responses exercise the real UI bridge."])}}
   {:name "excalidraw" :match ["excalidraw" "editable"]
    :spoken "This diagram can be edited inside the MCP App."
    :presentation {:kind "excalidraw" :title "Editable path"
                    :elements [{:type "cameraUpdate" :x 0 :y 0 :width 800 :height 600}
                               {:type "rectangle" :id "browser" :x 80 :y 120 :width 180 :height 80
                                :backgroundColor "#a5d8ff" :fillStyle "solid" :label {:text "Browser"}}
                               {:type "rectangle" :id "agent" :x 440 :y 120 :width 180 :height 80
                                :backgroundColor "#b2f2bb" :fillStyle "solid" :label {:text "Agent"}}]}}
   {:name "trace" :match ["trace" "playwright"]
    :spoken "This trace card shows the recorded journey and its failing action."
    :presentation {:kind "playwright-trace-viewer" :title "Local fixture journey"
                    :status "failed" :summary "UI fixture · latest" :project "voice" :run "fixture"
                    :traceId "0123456789abcdef0123456789abcdef" :durationMs 1240
                    :actionCount 2 :requestCount 4 :errorCount 1
                    :actions [{:label "Open conversation" :durationMs 310 :status "completed"}
                              {:label "Render trace" :durationMs 930 :status "failed"}]}}
   {:name "journal" :match ["journal" "annotation" "review"]
    :spoken "Review the suggested decision against its highlighted evidence."
    :presentation {:kind "journal-review" :reviewId "local-fixture" :title "Review journal extraction"
                    :source "Synthetic voice session"
                    :transcript "I want to improve the prompt and annotate examples before training."
                    :suggestion {:id "decision-1" :type "decision"
                                 :statement "Improve the prompt and annotate examples before training."
                                 :topics ["evaluation" "annotation"] :confidence 0.91
                                 :evidence {:quote "improve the prompt and annotate examples before training"
                                            :start 10 :end 65}}
                    :progress {:current 1 :total 3 :reviewed 0}}}])

(defn fixture-scene-names [] (mapv :name scenes))

(defn- local-origin [candidate]
  (try
    (let [uri (URI. (or candidate ""))]
      (if (and (= "http" (.getScheme uri))
               (contains? #{"localhost" "127.0.0.1"} (.getHost uri)))
        (str (.getScheme uri) "://" (.getAuthority uri))
        "http://127.0.0.1:8766"))
    (catch Exception _ "http://127.0.0.1:8766")))

(defn- trace-presentation [presentation origin]
  (let [base (local-origin origin)
        archive (str base "/api/playwright-traces/" (:traceId presentation) "/trace.zip")
        viewer (str base "/trace-viewer/index.html?trace=" (java.net.URLEncoder/encode archive "UTF-8"))]
    (assoc presentation
           :viewerUrl viewer
           :narratedVideoUrl (str base "/api/trace-explainers/abcdef0123456789abcdef0123456789/video"))))

(defn response-for-fixture-message [message origin]
  (let [normalized (str/lower-case (str (or message "")))
        scene (some #(when (some (fn [word] (str/includes? normalized word)) (:match %)) %) scenes)]
    (if scene
      {:spoken (:spoken scene)
       :presentation (if (= "trace" (:name scene))
                       (trace-presentation (:presentation scene) origin)
                       (:presentation scene))}
      {:spoken (str "Fixture response to: " (or message ""))
       :presentation {:kind "flow" :title "Response"
                      :nodes [{:id "request" :label "Request"} {:id "response" :label "Response"}]
                      :edges [{:from "request" :to "response"}]}})))
