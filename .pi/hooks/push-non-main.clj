#!/usr/bin/env bb
(ns push-non-main
  (:require [babashka.process :as process]
            [clojure.string :as string]))

(def workspace (or (System/getenv "PI_HOOK_WORKSPACE") "/workspace"))

(defn run [argv]
  @(apply process/process {:dir workspace :out :string :err :string} argv))

(defn checked [argv]
  (let [result (run argv)]
    (when-not (zero? (:exit result))
      (throw (ex-info (str "Command failed: " (first argv) " " (string/trim (:err result))) {})))
    (string/trim (:out result))))

(let [[fallback expected-origin] *command-line-args*]
  (when-not (and fallback (string/starts-with? fallback "pi/") expected-origin)
    (throw (ex-info "Pi fallback branch and Gitea origin are required" {})))
  (checked ["git" "check-ref-format" "--branch" fallback])
  (when-not (= expected-origin (checked ["git" "remote" "get-url" "origin"]))
    (throw (ex-info "Pi VM origin does not match its declared Gitea repository" {})))
  (let [branch-result (run ["git" "symbolic-ref" "--quiet" "--short" "HEAD"])
        branch (case (:exit branch-result)
                 0 (string/trim (:out branch-result))
                 1 nil
                 (throw (ex-info (string/trim (:err branch-result)) {})))
        branch (if (or (nil? branch) (#{"main" "master"} branch))
                 (do (checked ["git" "switch" "-c" fallback]) fallback)
                 branch)]
    (when (string/starts-with? branch "refs/")
      (throw (ex-info "Pi VM branch name is invalid" {})))
    (checked ["git" "push" "origin" (str "HEAD:refs/heads/" branch)])
    (println branch)))
