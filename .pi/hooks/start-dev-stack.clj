#!/usr/local/bin/bb

(ns start-dev-stack
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str])
  (:import (java.io File)
           (java.lang ProcessBuilder ProcessBuilder$Redirect)
           (java.nio.file FileAlreadyExistsException LinkOption StandardOpenOption)
           (java.net URI)
           (java.net.http HttpClient HttpRequest HttpResponse$BodyHandlers)
           (java.nio.charset StandardCharsets)
           (java.nio.file Files Paths)
           (java.security SecureRandom)
           (java.time Duration)))

(def preload-root "/image-cache")
(def base-compose-file "/workspace/products/voice-agent/deploy/compose.yml")
(def dev-compose-file "/workspace/.pi/compose.dev.yml")
(def full-compose-file "/workspace/.pi/compose.full-mock.yml")
(def secret-directory "/var/lib/gondolin-full-mock-secrets")
(def full-stack (= "full-mock" (System/getenv "GONDOLIN_COMPOSE_PROFILE")))
(def http-client (-> (HttpClient/newBuilder)
                     (.connectTimeout (Duration/ofSeconds 2))
                     (.build)))

(defn read-text [path]
  (slurp path))

(defn write-text! [path content]
  (spit path content :encoding "UTF-8"))

(defn empty-directory? [path]
  (and (not (Files/isSymbolicLink path))
       (Files/isDirectory path (make-array LinkOption 0))
       (with-open [entries (Files/list path)]
         (not (.isPresent (.findAny entries))))))

(defn link-vendor-sources! [workspace image-vendor-root]
  (doseq [name ["excalidraw-mcp" "mermaid-to-excalidraw"]]
    (let [source (Paths/get image-vendor-root (into-array String [name]))
          destination (Paths/get workspace (into-array String ["vendor" name]))]
      (when (Files/isDirectory source (make-array LinkOption 0))
        (Files/createDirectories (.getParent destination)
                                 (make-array java.nio.file.attribute.FileAttribute 0))
        (when (empty-directory? destination)
          (Files/delete destination))
        (when-not (Files/exists destination (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
          (Files/createSymbolicLink destination source
                                    (make-array java.nio.file.attribute.FileAttribute 0)))))))

(defn run-command
  ([argv] (run-command argv {}))
  ([argv {:keys [env timeout-ms] :or {env {} timeout-ms 240000}}]
   (let [child (apply process/process
                      {:out :string
                       :err :string
                       :extra-env env}
                      argv)
         result (deref child timeout-ms ::timeout)]
     (when (= ::timeout result)
       (process/destroy-tree child)
       (throw (ex-info (str "Command timed out: " (str/join " " argv))
                       {:timeout-ms timeout-ms})))
     (when-not (zero? (:exit result))
       (throw (ex-info (str "Command failed: " (str/join " " argv))
                       {:exit (:exit result)
                        :stderr (:err result)
                        :stdout (:out result)})))
     (str/trim (:out result)))))

(defn random-secret []
  (let [bytes (byte-array 32)]
    (.nextBytes (SecureRandom.) bytes)
    (apply str (map #(format "%02x" (bit-and (int %) 0xff)) bytes))))

(defn ensure-secret! [name value]
  (let [path (Paths/get secret-directory (into-array String [name]))]
    (try
      (Files/write path (.getBytes (str value "\n") StandardCharsets/UTF_8)
                   (into-array java.nio.file.OpenOption [StandardOpenOption/CREATE_NEW]))
      (catch FileAlreadyExistsException _ nil))
    (Files/setPosixFilePermissions path
                                  (java.nio.file.attribute.PosixFilePermissions/fromString "rw-r--r--"))
    (str/trim (read-text (str path)))))

(defn read-secret [name]
  (str/trim (read-text (str secret-directory "/" name))))

(defn http-ok? [url headers timeout-ms]
  (try
    (let [builder (-> (HttpRequest/newBuilder (URI/create url))
                      (.timeout (Duration/ofMillis timeout-ms))
                      (.GET))]
      (doseq [[name value] headers]
        (.header builder name value))
      (let [response (.send http-client (.build builder) (HttpResponse$BodyHandlers/discarding))]
        (<= 200 (.statusCode response) 299)))
    (catch Exception _ false)))

(defn wait-ready! [name url headers]
  (let [deadline (+ (System/currentTimeMillis) 120000)]
    (loop []
      (cond
        (http-ok? url headers 2000) nil
        (< (System/currentTimeMillis) deadline) (do (Thread/sleep 1000) (recur))
        :else (throw (ex-info (str name " did not become ready at " url " within 120000ms") {}))))))

(defn start-inference-mock! [token]
  (when-not (http-ok? "http://127.0.0.1:9443/health" {} 500)
    (let [builder (ProcessBuilder. ^java.util.List
                                  ["/usr/local/bin/bb"
                                   "-cp" "/workspace/products/voice-agent/apps/client/tool"
                                   "/workspace/products/voice-agent/apps/client/tool/patrol_mock_inference_broker.clj"])
          environment (.environment builder)]
      (.put environment "PATROL_BROKER_TOKEN" token)
      (.redirectOutput builder ProcessBuilder$Redirect/DISCARD)
      (.redirectError builder ProcessBuilder$Redirect/DISCARD)
      (.start builder)
      (loop [attempt 0]
        (cond
          (http-ok? "http://127.0.0.1:9443/health" {} 500) nil
          (< attempt 59) (do (Thread/sleep 250) (recur (inc attempt)))
          :else (throw (ex-info "Patrol inference mock did not become ready" {})))))))

(defn prepare-full-mock! []
  (Files/createDirectories (Paths/get secret-directory (make-array String 0))
                           (make-array java.nio.file.attribute.FileAttribute 0))
  (Files/setPosixFilePermissions (Paths/get secret-directory (make-array String 0))
                                (java.nio.file.attribute.PosixFilePermissions/fromString "rwxr-xr-x"))
  (doseq [script ["bootstrap-grafana-mcp.sh" "run-grafana-mcp.sh"]]
    (let [source (read-text (str "/workspace/products/voice-agent/deploy/observability/" script))
          content (if (= script "run-grafana-mcp.sh")
                    (str/replace source "--metrics-address 0.0.0.0:9090"
                                 "--metrics-address 127.0.0.1:9910")
                    source)]
      (let [path (str secret-directory "/" script)]
        (write-text! path content)
        (Files/setPosixFilePermissions (Paths/get path (make-array String 0))
                                      (java.nio.file.attribute.PosixFilePermissions/fromString "rw-r--r--")))))
  (let [routes (-> (read-text "/workspace/products/voice-agent/deploy/traefik/routes.yml")
                   (str/replace "http://otel-lgtm:3000" "http://127.0.0.1:3000")
                   (str/replace "http://gitea:3000" "http://127.0.0.1:3001")
                   (str/replace "http://habitat:7890" "http://127.0.0.1:7890"))
        traefik (str/replace (read-text "/workspace/products/voice-agent/deploy/traefik/traefik.yml")
                             "address: \"127.0.0.1:8080\""
                             "address: \"127.0.0.1:8082\"")]
    (write-text! (str secret-directory "/traefik-routes.yml") routes)
    (write-text! (str secret-directory "/traefik.yml") traefik))
  (let [postgres-password (ensure-secret! "postgres-password" (random-secret))
        habitat-password (ensure-secret! "habitat-database-password" postgres-password)
        sql-template (read-text "/workspace/.pi/postgres-full-mock-init.sql.template")
        sql (str/replace sql-template "__HABITAT_PASSWORD__"
                         (str/replace habitat-password "'" "''"))]
    (write-text! (str secret-directory "/compose-full-mock-init.sql") sql)
    (ensure-secret! "database-url"
                    (str "postgresql://voice_agents:" postgres-password "@127.0.0.1:5432/voice_agents")))
  (let [broker-token (ensure-secret! "broker-token" (random-secret))]
    (doseq [name ["agent-gateway-token" "digital-twin-reader-token"
                  "digital-twin-writer-token" "approval-secret"
                  "grafana-admin-password" "grafana-mcp-caller-token"]]
      (ensure-secret! name (random-secret)))
    (start-inference-mock! broker-token)
    broker-token))

(defn compose-environment [broker-token]
  (let [base (into {} (System/getenv))
        compose-file (str base-compose-file ":" dev-compose-file
                          (when full-stack (str ":" full-compose-file)))
        defaults {"COMPOSE_FILE" compose-file
                  "COMPOSE_PROFILES" ""
                  "PATH" (str "/usr/local/bin:/usr/local/sbin:" (get base "PATH" "/usr/bin:/bin"))
                  "ORCHESTRATOR_ALLOWED_WORKSPACES" "/workspace"
                  "VOICE_DEFAULT_WORKSPACE" "/workspace"
                  "OLLAMA_MODEL" "dev-mock"}]
    (cond-> (merge base defaults)
      full-stack (merge {"POSTGRES_PASSWORD" (read-secret "postgres-password")
                         "HABITAT_DB_PASSWORD" (read-secret "habitat-database-password")
                         "INFERENCE_BROKER_TOKEN" broker-token
                         "AGENT_GATEWAY_TOKEN" (read-secret "agent-gateway-token")
                         "DIGITAL_TWIN_READER_TOKEN" (read-secret "digital-twin-reader-token")
                         "DIGITAL_TWIN_WRITER_TOKEN" (read-secret "digital-twin-writer-token")
                         "GRAFANA_MCP_SERVER_TOKEN" (read-secret "grafana-mcp-caller-token")
                         "GRAFANA_ADMIN_PASSWORD" (read-secret "grafana-admin-password")
                         "ORCHESTRATOR_WORKSPACE_ROOTS" "/workspace"}))))

(defn compose-files []
  (concat ["-f" base-compose-file "-f" dev-compose-file]
          (when full-stack ["-f" full-compose-file])))

(defn run-compose [environment & args]
  (run-command (into ["/usr/local/bin/dev-compose"] args) {:env environment}))

(defn validate-preload! [services index]
  (let [configured (set services)
        cached (->> (get index "services") keys (filter configured) sort vec)]
    (when (empty? cached)
      (throw (ex-info "image preload index has no active Compose services" {})))
    (doseq [service cached]
      (let [{image "image" archive "archive" checksum "sha256"} (get-in index ["services" service])]
        (when-not (and (string? image) (re-matches #"gondolin-preload:[a-f0-9]{24}" image)
                       (string? archive) (re-matches #"[a-f0-9]{24}\.tar" archive)
                       (string? checksum) (re-matches #"[a-f0-9]{64}" checksum))
          (throw (ex-info (str "image preload has no valid " service " entry") {})))))
    cached))

(defn wait-bootstrap! [environment]
  (let [deadline (+ (System/currentTimeMillis) 120000)]
    (loop []
      (let [container-id (run-command ["/usr/local/bin/dev-compose" "ps" "--all" "-q" "grafana-mcp-bootstrap"]
                                      {:env environment})]
        (if (seq container-id)
          (let [state (run-command ["docker" "inspect" "--format={{.State.Status}}:{{.State.ExitCode}}" container-id])]
            (cond
              (str/starts-with? state "exited:0") nil
              (str/starts-with? state "exited:")
              (throw (ex-info (str "Grafana MCP bootstrap failed (" state ")") {}))
              (< (System/currentTimeMillis) deadline) (do (Thread/sleep 500) (recur))
              :else (throw (ex-info "Grafana MCP bootstrap did not finish within 120000ms" {}))))
          (if (< (System/currentTimeMillis) deadline)
            (do (Thread/sleep 500) (recur))
            (throw (ex-info "Grafana MCP bootstrap did not finish within 120000ms" {}))))))))

(defn -main []
  (link-vendor-sources! "/workspace" "/opt/vendor")
  (let [index-path (str preload-root "/index.json")]
    (if-not (.exists (File. index-path))
      (println "dev Compose skipped: image preload is not mounted")
      (let [index (json/parse-string (read-text index-path))
            broker-token (when full-stack (prepare-full-mock!))
            environment (compose-environment broker-token)
            services (-> (run-command (concat ["docker" "compose"]
                                              (compose-files)
                                              ["config" "--services"])
                                      {:env environment})
                         (str/split-lines)
                         (->> (remove str/blank?) vec))]
        (let [preload-services (validate-preload! services index)
              compose-environment (assoc environment "COMPOSE_CACHE_SERVICES"
                                         (str/join "," preload-services))
              base-services (filter (set services)
                                    ["postgres" "s3mock-init" "s3mock" "oxigraph-init" "oxigraph"
                                     "gitea" "habitat" "fluent-bit" "otel-lgtm"])]
          (if full-stack
            (apply run-compose compose-environment "up" "--detach" base-services)
            (apply run-compose compose-environment "up" "--detach" "--wait" "--wait-timeout" "180"
                   (remove #{"oxigraph-init"} services)))
          (doseq [[name url] [["Grafana" "http://127.0.0.1:3000/api/health"]
                              ["Prometheus" "http://127.0.0.1:9090/-/ready"]
                              ["S3Mock" "http://127.0.0.1:9092/favicon.ico"]
                              ["Gitea" "http://127.0.0.1:3001/api/healthz"]
                              ["Oxigraph" "http://127.0.0.1:7878/"]]]
            (if full-stack
              (wait-ready! name url {})
              (when-not (http-ok? url {} 2000)
                (throw (ex-info (str name " did not become ready at " url) {})))))
          (when full-stack
            (run-compose compose-environment "up" "--detach" "--no-deps" "grafana-mcp-bootstrap")
            (wait-bootstrap! compose-environment)
            (let [service-set (set services)
                  dependencies (filter service-set ["grafana-mcp" "agent-gateway" "trace-render-worker"])]
              (apply run-compose compose-environment "up" "--detach" "--no-deps" dependencies)
              (doseq [[name url headers] [["mock inference broker" "http://127.0.0.1:9443/health" {}]
                                          ["Habitat" "http://127.0.0.1:7890/queue/_healthz" {}]
                                          ["agent gateway" "http://127.0.0.1:9444/health"
                                           {"Authorization" (str "Bearer " (read-secret "agent-gateway-token"))}]
                                          ["Grafana MCP" "http://127.0.0.1:8080/healthz" {}]
                                          ["trace render worker" "http://127.0.0.1:9460/health" {}]]]
                (wait-ready! name url headers))
              (when (service-set "voice-edge")
                (run-compose compose-environment "up" "--detach" "--no-deps" "voice-edge")
                (wait-ready! "voice edge" "http://127.0.0.1:7860/api/features" {}))
              (when (service-set "traefik")
                (run-compose compose-environment "up" "--detach" "--no-deps" "traefik")
                (wait-ready! "Traefik local ingress" "http://127.0.0.1:8081/" {}))))
          (println (str "dev Compose ready: " (str/join ", " services))))))))

(defn -main-with-diagnostics []
  (try
    (-main)
    (catch Exception error
      (let [environment (try
                          (compose-environment (when full-stack (read-secret "broker-token")))
                          (catch Exception _ (into {} (System/getenv))))
            diagnostics (transient [(str error)])]
        (doseq [args [["ps" "--all"] ["logs" "--no-color" "--tail" "80"]]]
          (try
            (conj! diagnostics (run-command (concat ["docker" "compose"] (compose-files) args)
                                            {:env environment}))
            (catch Exception diagnostic-error
              (conj! diagnostics (str diagnostic-error)))))
        (try
          (let [report (str/join "\n\n" (persistent! diagnostics))]
            (write-text! "/workspace/.pi/full-compose-startup-diagnostic.log"
                         (subs report 0 (min 16000 (count report)))))
          (catch Exception _ nil))
        (throw error)))))

(when (= *file* (System/getProperty "babashka.file"))
  (try
    (-main-with-diagnostics)
    (catch Exception error
      (binding [*out* *err*]
        (println (str "dev Compose startup failed: " (.getMessage error)))
        (when-let [detail (:stderr (ex-data error))]
          (println (subs detail 0 (min 4000 (count detail))))))
      (System/exit 1))))
