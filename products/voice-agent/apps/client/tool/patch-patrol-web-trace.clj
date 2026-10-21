(ns patch-patrol-web-trace
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def start-marker
  "await context.tracing.start({ screenshots: true, snapshots: true, sources: true })")
(def stop-marker
  "await context.tracing.stop({ path: testInfo.outputPath(\"trace.zip\") })")
(def fixture-start
  "  page: async ({ page, context }, use, testInfo) => {\n")
(def fixture-end
  (str "    for (const p of context.pages()) {\n"
       "      if (p !== page && !p.isClosed()) {\n"
       "        await p.close().catch(() => {})\n"
       "      }\n"
       "    }\n"))

(defn replace-once [source needle replacement]
  (let [index (.indexOf ^String source ^String needle)]
    (when (neg? index)
      (throw (ex-info "Expected text not found" {:needle needle})))
    (str (subs source 0 index) replacement (subs source (+ index (count needle))))))

(defn patch-runner! [runner]
  (let [source (slurp (str runner))
        has-start (str/includes? source start-marker)
        has-stop (str/includes? source stop-marker)]
    (when (not= has-start has-stop)
      (throw (ex-info "Patrol web runner has a partial trace patch; refusing to continue." {})))
    (when-not (and has-start has-stop)
      (when-not (and (str/includes? source fixture-start) (str/includes? source fixture-end))
        (throw (ex-info "Patrol 4.10.0 web runner changed; refusing to apply the trace patch." {})))
      (let [patched (-> source
                        (replace-once fixture-start (str fixture-start "    " start-marker "\n"))
                        (replace-once fixture-end (str fixture-end "\n    " stop-marker "\n")))]
        (spit (str runner) patched)))))

(defn -main [& args]
  (when-not (= 1 (count args))
    (throw (ex-info "Usage: patch-patrol-web-trace.clj <runner>" {})))
  (patch-runner! (fs/absolutize (first args))))

(when (= *file* (System/getProperty "babashka.file"))
  (apply -main *command-line-args*))
