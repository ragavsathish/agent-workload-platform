#!/usr/bin/env bb
(ns container-mock.pi-durable-owner-server
  (:require [container-mock.pi-durable-owner :as owner]
            [patrol-http :as http]))

(defn start! [port]
  (let [current (atom (owner/initial-state))]
    (http/start! {:port port :handler (fn [request]
                                       (let [{:keys [state response]} (owner/transition @current request)]
                                         (reset! current state)
                                         response))})))

(when (= *file* (System/getProperty "babashka.file"))
  (let [server (start! (Integer/parseInt (or (System/getenv "MOCK_OWNER_PORT") "0")))]
    (println (:port server))
    (flush)
    @(promise)))
