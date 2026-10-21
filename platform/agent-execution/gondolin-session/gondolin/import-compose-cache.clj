#!/usr/local/bin/bb

(ns import-compose-preload
  (:require [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str])
  (:import (java.nio.file Files LinkOption Path Paths StandardCopyOption)
           (java.security MessageDigest)
           (java.util UUID)))

(defn command [& args]
  (str/trim (:out (apply process/shell {:out :string :err :inherit} args))))

(defn sha256-file [path]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (with-open [input (Files/newInputStream path (make-array java.nio.file.OpenOption 0))]
      (let [buffer (byte-array 1048576)]
        (loop []
          (let [length (.read input buffer)]
            (when (pos? length)
              (.update digest buffer 0 length)
              (recur))))))
    (apply str (map #(format "%02x" (bit-and (int %) 0xff)) (.digest digest)))))

(defn regular-file! [path label]
  (when-not (and (not (Files/isSymbolicLink path))
                 (Files/isRegularFile path (into-array LinkOption [LinkOption/NOFOLLOW_LINKS])))
    (throw (ex-info (str label " is not a regular file: " path) {})))
  path)

(defn archive-name! [archive]
  (when-not (and (string? archive) (re-matches #"[a-f0-9]{24}\.tar" archive))
    (throw (ex-info (str "invalid image archive name: " archive) {})))
  archive)

(defn verify-archive! [path checksum]
  (regular-file! path "image archive")
  (when-not (= checksum (sha256-file path))
    (throw (ex-info (str "image archive checksum mismatch: " path) {})))
  (let [members (set (str/split-lines (command "tar" "-tf" (str path))))]
    (when-not (or (contains? members "manifest.json")
                  (and (contains? members "oci-layout") (contains? members "index.json")))
      (throw (ex-info (str "image archive has no Docker or OCI manifest: " path) {}))))
  path)

(defn move-atomically! [temporary destination]
  (Files/move temporary destination
              (into-array StandardCopyOption [StandardCopyOption/ATOMIC_MOVE
                                              StandardCopyOption/REPLACE_EXISTING])))

(defn install-archive! [handoff-directory shared-directory archive checksum]
  (let [source (.resolve handoff-directory archive)
        destination (.resolve shared-directory archive)]
    (Files/createDirectories shared-directory (make-array java.nio.file.attribute.FileAttribute 0))
    (if (Files/exists destination (make-array LinkOption 0))
      (verify-archive! destination checksum)
      (do
        (verify-archive! source checksum)
        (let [temporary (.resolve shared-directory (str archive "." (UUID/randomUUID) ".partial"))]
          (try
            (Files/copy source temporary (make-array StandardCopyOption 0))
            (verify-archive! temporary checksum)
            (try
              (try
                (Files/createLink destination temporary)
                (Files/delete temporary)
                (catch UnsupportedOperationException _
                  (Files/move temporary destination)))
              (catch java.nio.file.FileAlreadyExistsException _
                (verify-archive! destination checksum)))
            (finally
              (Files/deleteIfExists temporary)))))))
  archive)

(defn write-json-atomically! [path value]
  (let [temporary (.resolve (.getParent ^Path path) (str (.getFileName ^Path path) "." (UUID/randomUUID) ".tmp"))]
    (try
      (spit (str temporary) (str (json/generate-string value {:pretty true}) "\n") :encoding "UTF-8")
      (move-atomically! temporary path)
      (finally
        (Files/deleteIfExists temporary)))))

(defn write-text-atomically! [path value]
  (let [temporary (.resolve (.getParent ^Path path) (str (.getFileName ^Path path) "." (UUID/randomUUID) ".tmp"))]
    (try
      (spit (str temporary) (str value "\n") :encoding "UTF-8")
      (move-atomically! temporary path)
      (finally
        (Files/deleteIfExists temporary)))))

(defn prune-local-archives! [directory]
  (when (Files/isDirectory directory (into-array LinkOption [LinkOption/NOFOLLOW_LINKS]))
    (with-open [archives (Files/newDirectoryStream directory)]
      (doseq [archive archives
              :let [filename (str (.getFileName ^Path archive))]
              :when (re-matches #"[a-f0-9]{24}\.tar(?:\.zst)?" filename)]
        (Files/delete archive)))))

(defn import-preload! [handoff-root-argument preload-root-argument shared-root-argument]
  (let [handoff-root (.toAbsolutePath (.normalize (Paths/get handoff-root-argument (make-array String 0))))
        preload-root (.toAbsolutePath (.normalize (Paths/get preload-root-argument (make-array String 0))))
        shared-root (.toAbsolutePath (.normalize (Paths/get shared-root-argument (make-array String 0))))
        handoff-image-directory (.resolve (.resolve handoff-root "agent") "images")
        shared-image-directory (.resolve (.resolve shared-root "agent") "images")
        index-path (.resolve handoff-root "index.json")
        override-path (.resolve handoff-root "compose.override.json")
        cache-id-path (.resolve handoff-root "cache-id")]
    (regular-file! index-path "cache index")
    (regular-file! override-path "Compose override")
    (regular-file! cache-id-path "cache id")
    (let [index (json/parse-string (slurp (str index-path)))
          override (json/parse-string (slurp (str override-path)))
          cache-id (str/trim (slurp (str cache-id-path)))
          services (get index "services")]
      (when-not (and (map? services) (seq services)
                     (re-matches #"[a-f0-9]{64}" cache-id))
        (throw (ex-info "handoff index or cache id is invalid" {})))
      (let [entries (->> services
                        (map (fn [[service entry]]
                               (let [archive (archive-name! (get entry "archive"))
                                     checksum (get entry "sha256")]
                                 (when-not (and (string? service)
                                                (map? entry)
                                                (string? checksum)
                                                (re-matches #"[a-f0-9]{64}" checksum))
                                   (throw (ex-info (str "invalid cache entry for service " service) {})))
                                 [archive checksum])))
                        distinct)]
        (doseq [[archive checksum] entries]
          (install-archive! handoff-image-directory shared-image-directory archive checksum))
        (let [preload-directory (.resolve (.resolve preload-root "agent") "images")]
          (Files/createDirectories preload-directory (make-array java.nio.file.attribute.FileAttribute 0))
          (Files/createDirectories preload-root (make-array java.nio.file.attribute.FileAttribute 0))
          (write-json-atomically! (.resolve preload-root "compose.override.json") override)
          (write-json-atomically! (.resolve preload-root "index.json") index)
          (write-text-atomically! (.resolve preload-root "cache-id") cache-id)
          (prune-local-archives! preload-directory))
        (doseq [[archive _] entries]
          (Files/deleteIfExists (.resolve handoff-image-directory archive)))
        (println (str "Imported " (count entries) " shared image archives for " (count services)
                      " Compose services from " handoff-root))))))

(defn -main [& args]
  (when-not (= 3 (count args))
    (throw (ex-info "Usage: import-compose-cache.clj <handoff-root> <preload-root> <shared-store-root>" {})))
  (apply import-preload! args))

(when (= *file* (System/getProperty "babashka.file"))
  (try
    (apply -main *command-line-args*)
    (catch Exception error
      (binding [*out* *err*]
        (println (.getMessage error)))
      (System/exit 1))))
