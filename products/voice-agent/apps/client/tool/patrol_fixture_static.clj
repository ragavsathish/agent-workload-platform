(ns patrol-fixture-static
  (:require [clojure.string :as str])
  (:import [java.net URLDecoder]
           [java.nio.charset StandardCharsets]
           [java.nio.file Files Paths LinkOption]))

(def ^:private mime-types
  {".css" "text/css" ".html" "text/html" ".ico" "image/x-icon"
   ".js" "text/javascript" ".json" "application/json" ".map" "application/json"
   ".mjs" "text/javascript" ".png" "image/png" ".svg" "image/svg+xml"
   ".wasm" "application/wasm" ".woff" "font/woff" ".woff2" "font/woff2"})

(defn static-path [root pathname]
  (try
    (let [decoded (URLDecoder/decode (str/replace pathname "+" "%2B") "UTF-8")
          root-path (.toAbsolutePath (.normalize (Paths/get (str root) (make-array String 0))))
          relative (if (= decoded "/") "index.html" (subs decoded 1))
          target (.normalize (.resolve root-path relative))]
      (when (and (not (str/includes? decoded "\u0000"))
                 (not (str/includes? decoded "\\"))
                 (.startsWith target root-path))
        target))
    (catch Exception _ nil)))

(defn serve-static [root pathname]
  (when-let [path (static-path root pathname)]
    (when (Files/isRegularFile path (make-array LinkOption 0))
      (let [name (str (.getFileName path))
            dot (.lastIndexOf name ".")
            extension (if (neg? dot) "" (subs name dot))
            bytes (Files/readAllBytes path)]
        {:status 200 :body bytes
         :headers {"Cache-Control" "no-store"
                   "Content-Type" (get mime-types extension "application/octet-stream")
                   "X-Content-Type-Options" "nosniff"}}))))
