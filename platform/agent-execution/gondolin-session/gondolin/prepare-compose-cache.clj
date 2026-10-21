#!/usr/local/bin/bb

;; Run on the trusted host once; it never builds application source.
;; The resulting Docker archive is mounted read-only into each development VM.
(ns prepare-compose-preload
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str])
  (:import (java.nio.charset StandardCharsets)
           (java.nio.file Files Path Paths StandardCopyOption)
           (java.security MessageDigest)
           (java.util UUID)))

(defn command [& args]
  (str/trim (:out (apply process/shell {:out :string :err :inherit} args))))

(defn archive-json [archive member]
  (json/parse-string (command "tar" "-xOf" (str archive) member)))

(defn descriptor-path [descriptor]
  (when-let [[_ algorithm digest] (re-matches #"([a-z0-9]+):([a-f0-9]+)" (get descriptor "digest" ""))]
    (str "blobs/" algorithm "/" digest)))

(defn complete-oci-manifest? [archive files descriptor]
  (when-let [member (descriptor-path descriptor)]
    (when (contains? files member)
      (let [manifest (archive-json archive member)]
        (if-let [manifests (seq (get manifest "manifests"))]
          (some #(complete-oci-manifest? archive files %) manifests)
          (let [blobs (cons (get manifest "config") (get manifest "layers"))]
            (and (seq (get manifest "layers"))
                 (every? (fn [blob]
                           (when-let [path (descriptor-path blob)]
                             (contains? files path)))
                         blobs))))))))

(defn sha256 [value]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256")
                        (.getBytes value StandardCharsets/UTF_8))]
    (apply str (map #(format "%02x" (bit-and (int %) 0xff)) digest))))

(defn validate-archive! [archive]
  (let [files (->> (command "tar" "-tf" (str archive))
                   str/split-lines
                   set)]
    (if (and (contains? files "oci-layout") (contains? files "index.json"))
      (when-not (some #(complete-oci-manifest? archive files %)
                      (get (archive-json archive "index.json") "manifests"))
        (throw (ex-info (str "incomplete OCI image archive " archive) {})))
      (let [manifests (archive-json archive "manifest.json")]
        (doseq [manifest manifests
                path (cons (get manifest "Config") (get manifest "Layers"))]
          (when-not (contains? files path)
            (throw (ex-info (str "incomplete Docker image archive " archive ": missing " path) {}))))))))

(defn file-sha256 [path]
  (first (str/split (command "sha256sum" (str path)) #"\s+")))

(defn docker-image-id [image]
  (command "docker" "image" "inspect" image "--format" "{{.Id}}"))

(defn preload-for-service [name service]
  (let [image (get service "image")]
    (when (seq image)
      (let [image-id (try
                       (docker-image-id image)
                       (catch Exception _
                         (if (get service "build")
                           (throw (ex-info (str name " is built from source. Build it inside a VM and promote its image before preparing the shared cache.") {}))
                           (do (command "docker" "pull" image)
                               (docker-image-id image)))))
            key (subs (sha256 (str image "\n" image-id)) 0 24)
            preload-tag (str "gondolin-preload:" key)]
        (command "docker" "tag" image-id preload-tag)
        {:tag preload-tag
         :key key
         :source image
         :imageId image-id
         :archive (str key ".tar")}))))

(defn write-json! [path value]
  (spit (str path) (str (json/generate-string value {:pretty true}) "\n")
        :encoding "UTF-8"))

(defn prune-unused-preloads! [preload-directory referenced-archives]
  (with-open [archives (Files/newDirectoryStream preload-directory)]
    (doseq [archive archives
            :let [filename (str (.getFileName ^Path archive))]
            :when (and (re-matches #"[a-f0-9]{24}\.tar(?:\.zst)?" filename)
                       (not (contains? referenced-archives filename)))]
      (Files/delete archive))))

(defn ensure-shared-archive! [image shared-directory]
  (let [archive (.resolve shared-directory (:archive image))]
    (if (Files/exists archive (make-array java.nio.file.LinkOption 0))
      (validate-archive! archive)
      (let [temporary (.resolve shared-directory
                                (str (:key image) "." (UUID/randomUUID) ".tar"))]
        (try
          (command "docker" "save" "--output" (str temporary) (:tag image))
          (validate-archive! temporary)
          (try
            (Files/move temporary archive (into-array StandardCopyOption [StandardCopyOption/ATOMIC_MOVE]))
            (catch java.nio.file.FileAlreadyExistsException _ nil))
          (finally
            (Files/deleteIfExists temporary)))))
    archive))

(defn prepare-preload! [compose-argument preload-root-argument shared-root-argument]
  (let [compose-path (.toString (.toAbsolutePath (.normalize (Paths/get compose-argument (make-array String 0)))))
        preload-root (.toAbsolutePath (.normalize (Paths/get preload-root-argument (make-array String 0))))
        shared-root (.toAbsolutePath (.normalize (Paths/get shared-root-argument (make-array String 0))))
        config (-> (command "docker" "compose" "-f" compose-path "config" "--format" "json")
                   json/parse-string)
        compose-services (get config "services")]
    (when-not (map? compose-services)
      (throw (ex-info "Compose configuration has no services" {})))
    (let [service-images (->> compose-services
                              (keep (fn [[name service]]
                                      (when-let [image (preload-for-service name service)]
                                        [name image])))
                              (into (array-map)))
          images (->> (vals service-images)
                      (reduce (fn [result image]
                                (assoc result (:tag image) image))
                              (array-map)))]
      (when (empty? images)
        (throw (ex-info "Compose configuration has no images to cache" {})))
      (let [cache-entries (->> images
                               (sort-by key)
                               (mapv (fn [[tag image]]
                                       [tag {"source" (:source image) "imageId" (:imageId image)}])))
            cache-id (sha256 (json/generate-string cache-entries))
            services (into (array-map)
                           (map (fn [[name image]]
                                  [name {"image" (:tag image) "pull_policy" "never"}])
                                service-images))
            preload-directory (.resolve (.resolve preload-root "agent") "images")
            shared-directory (.resolve (.resolve shared-root "agent") "images")]
        (Files/createDirectories preload-directory (make-array java.nio.file.attribute.FileAttribute 0))
        (Files/createDirectories shared-directory (make-array java.nio.file.attribute.FileAttribute 0))
        (let [archive-checksums
              (into {}
                    (for [[_ image] images
                          :let [shared-archive (ensure-shared-archive! image shared-directory)]]
                      [(:tag image) (file-sha256 shared-archive)]))
              index-services (into (array-map)
                                   (map (fn [[name image]]
                                          [name {"image" (:tag image)
                                                 "archive" (:archive image)
                                                 "sha256" (get archive-checksums (:tag image))}])
                                        service-images))]
        (write-json! (.resolve preload-root "compose.override.json") {"services" services})
        (write-json! (.resolve preload-root "index.json") {"services" index-services})
        (spit (str (.resolve preload-root "cache-id")) (str cache-id "\n") :encoding "UTF-8")
        (prune-unused-preloads! preload-directory #{})
        (println (str "Prepared image preload: " (count images) " image tags for " (count services)
                      " Compose services in " preload-root " (shared store " shared-directory ")")))))))

(defn -main [& args]
  (when-not (= 3 (count args))
    (throw (ex-info "Usage: prepare-compose-cache.clj <compose.yml> <preload-root> <shared-store-root>" {})))
  (apply prepare-preload! args))

(when (= *file* (System/getProperty "babashka.file"))
  (try
    (apply -main *command-line-args*)
    (catch Exception error
      (binding [*out* *err*]
        (println (.getMessage error))
        (when-let [details (:stderr (ex-data error))]
          (print details)))
      (System/exit 1))))
