#!/usr/local/bin/bb

(ns select-compose-preload
  (:require [cheshire.core :as json]
            [clojure.string :as str]))

(defn select-preload-archives [index selection]
  (let [archives (->> (str/split selection #",")
                      (map str/trim)
                      (remove str/blank?)
                      (map (fn [service]
                             (let [archive (get-in index ["services" service "archive"])
                                   checksum (get-in index ["services" service "sha256"])]
                               (when-not (and (string? archive)
                                              (re-matches #"[a-f0-9]{24}\.tar" archive)
                                              (string? checksum)
                                              (re-matches #"[a-f0-9]{64}" checksum))
                                 (throw (ex-info (str "No cached image for Compose service: " service) {})))
                               [archive checksum])))
                      distinct
                      sort
                      vec)]
    (when (empty? archives)
      (throw (ex-info "COMPOSE_CACHE_SERVICES must name at least one service" {})))
    archives))

(defn -main [& args]
  (when-not (= 2 (count args))
    (throw (ex-info "Usage: select-compose-images.clj <index.json> <service,service>" {})))
  (let [[index-path selection] args
        index (json/parse-string (slurp index-path))]
    (doseq [[archive checksum] (select-preload-archives index selection)]
      (println (str archive "\t" checksum)))))

(when (= *file* (System/getProperty "babashka.file"))
  (try
    (apply -main *command-line-args*)
    (catch Exception error
      (binding [*out* *err*]
        (println (.getMessage error)))
      (System/exit 1))))
