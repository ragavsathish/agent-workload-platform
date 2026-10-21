(ns c4-dashboard-test
  (:require [clojure.test :refer [deftest is testing run-tests]]))

(load-file "deploy/observability/c4-dashboard.clj")
(load-file "deploy/observability/generate-c4-heatmap.clj")

(def input
  {:options {:dashboard-title "Voice Architecture"
             :dashboard-uid "voice-c4-test"
             :description "Generated test dashboard"
             :refresh "10s"
             :time-from "now-15m"
             :evidence-markdown "## Evidence"}
   :diagrams [{:id "context" :title "C1"
               :mermaid "C4Context\nSystem(system, \"System\", \"Test\")"
               :width 12 :height 14}
              {:id "deployment" :title "Deployment"
               :mermaid "flowchart LR\nEDGE[Edge] --> OTEL[OTel]"
               :width 12 :height 14}]
   :evidence [{:diagram-id "context" :element-id "system" :status "strong"}
              {:diagram-id "deployment" :element-id "EDGE" :status "partial"}]
   :activity [{:diagram-id "deployment" :element-id "EDGE" :ref-id "A"
               :service-name "voice-edge"}]})

(deftest compiles-deterministic-c4-panels-and-promql-overlays
  (let [dashboard (c4-dashboard/compile-dashboard input)]
    (is (= "Voice Architecture" (:title dashboard)))
    (is (= 3 (count (:panels dashboard))))
    (is (re-find #"UpdateElementStyle\(system" (get-in dashboard [:panels 1 :options :content])))
    (is (re-find #"style EDGE fill:\$\{__data\.A:color\}"
                 (get-in dashboard [:panels 2 :options :content])))
    (is (re-find #"service_name=\"voice-edge\""
                 (get-in dashboard [:panels 2 :targets 0 :expr])))
    (is (= ["c4" "architecture" "evidence" "prometheus" "grafana-mcp"]
           (:tags dashboard)))))

(deftest rejects-invalid-and-duplicate-query-references
  (testing "invalid ref IDs"
    (is (thrown-with-msg? Exception #"expected one uppercase letter"
                          (c4-dashboard/compile-dashboard
                           (assoc input :activity [(assoc (first (:activity input)) :ref-id "voice_edge")])))))
  (testing "duplicate ref IDs within a diagram"
    (is (thrown-with-msg? Exception #"duplicate query reference"
                          (c4-dashboard/compile-dashboard
                           (update input :activity conj
                                   (assoc (first (:activity input)) :element-id "OTEL")))))))

(deftest escapes-prometheus-label-values
  (is (= "service\\\\\\\"name"
         (c4-dashboard/escape-prometheus-label "service\\\"name"))))

(deftest assembles-the-source-backed-heat-map-in-process
  (let [dashboard (generate-c4-heatmap/build-dashboard)]
    (is (= "voice-c4-heatmap" (:uid dashboard)))
    (is (= 16 (count (:panels dashboard))))
    (is (re-find #"Grafana node backgrounds are intentionally neutral"
                 (get-in dashboard [:panels 1 :options :content])))))

(let [{:keys [fail error]} (run-tests)]
  (when (pos? (+ fail error)) (System/exit 1)))
