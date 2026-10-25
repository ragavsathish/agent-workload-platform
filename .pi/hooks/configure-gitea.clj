#!/usr/bin/env bb
(ns configure-gitea
  (:require [babashka.process :as process]
            [clojure.string :as string])
  (:import [java.nio.charset StandardCharsets]
           [java.nio.file Files Paths]
           [java.util Base64]))

(defn required-env [name]
  (or (not-empty (System/getenv name))
      (throw (ex-info (str name " is required") {}))))

(def workspace (or (System/getenv "PI_HOOK_WORKSPACE") "/workspace"))

(defn run! [argv]
  (let [result @(apply process/process {:dir workspace :out :string :err :string} argv)]
    (when-not (zero? (:exit result))
      (throw (ex-info (str "Command failed: " (first argv) " " (string/trim (:err result))) {})))
    (string/trim (:out result))))

(let [base-url (required-env "GITEA_BASE_URL")
      owner (required-env "GITEA_OWNER")
      repository (required-env "GITEA_REPOSITORY")
      username (required-env "GITEA_USERNAME")
      token (required-env "GITEA_TOKEN")
      tea (Paths/get "/usr/local/bin/tea" (make-array String 0))
      credential (.encodeToString (Base64/getEncoder)
                                  (.getBytes (str username ":" token) StandardCharsets/UTF_8))]
  (when (Files/isExecutable tea)
    (run! [(.toString tea) "login" "add" "--name" "local" "--url" base-url
           "--token" token "--no-version-check"]))
  (run! ["git" "config" "--global" (str "http." base-url "/.extraHeader")
         (str "Authorization: Basic " credential)])
  (run! ["git" "config" "remote.origin.url"
         (str base-url "/" owner "/" repository ".git")]))
