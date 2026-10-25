(ns patrol-http
  (:require [clojure.string :as str])
  (:import [java.net ServerSocket InetAddress URI]
           [java.io ByteArrayOutputStream BufferedInputStream BufferedOutputStream]
           [java.util.concurrent Executors TimeUnit]))

(def ^:private reasons {200 "OK" 201 "Created" 204 "No Content" 400 "Bad Request"
                        401 "Unauthorized" 404 "Not Found" 405 "Method Not Allowed"
                        503 "Service Unavailable"
                        409 "Conflict" 501 "Not Implemented"})

(defn- line! [in]
  (let [out (ByteArrayOutputStream.)]
    (loop [previous -1]
      (let [byte (.read in)]
        (cond
          (= byte -1) (when (pos? (.size out)) (.toString out "UTF-8"))
          (= [previous byte] [13 10]) (.toString out "UTF-8")
          :else (do (when (not= byte 13) (.write out byte)) (recur byte)))))))

(defn- read-request [socket]
  (let [in (BufferedInputStream. (.getInputStream socket))
        first-line (line! in)]
    (when first-line
      (let [[method target _] (str/split first-line #" ")
            headers (loop [result {}]
                      (let [line (line! in)]
                        (if (or (nil? line) (empty? line)) result
                          (let [[key value] (str/split line #":" 2)]
                            (recur (assoc result (str/lower-case key) (str/trim value)))))))
            length (Long/parseLong (get headers "content-length" "0"))
            body (byte-array (int (min length 10485760))) ]
        (loop [offset 0]
          (when (< offset (alength body))
            (let [read (.read in body offset (- (alength body) offset))]
              (when (pos? read) (recur (+ offset read))))))
        {:method method :path (.getPath (URI/create target)) :query (.getRawQuery (URI/create target))
         :headers headers :body (String. body "UTF-8")}))))

(defn- write-response! [socket response]
  (let [status (or (:status response) 200)
        body (let [value (:body response)]
               (cond (nil? value) (byte-array 0)
                     (instance? (Class/forName "[B") value) value
                     :else (.getBytes (str value) "UTF-8")))
        headers (merge (cond-> {"Connection" "close"}
                         (not= 204 status) (assoc "Content-Length" (str (alength ^bytes body))))
                       (:headers response))
        out (BufferedOutputStream. (.getOutputStream socket))]
    (.write out (.getBytes (str "HTTP/1.1 " status " " (get reasons status "OK") "\r\n") "US-ASCII"))
    (doseq [[key value] headers]
      (.write out (.getBytes (str key ": " value "\r\n") "US-ASCII")))
    (.write out (.getBytes "\r\n" "US-ASCII"))
    (when (pos? (alength ^bytes body)) (.write out ^bytes body))
    (.flush out)))

(defn start! [{:keys [host port handler]
               :or {host "127.0.0.1" port 0}}]
  (let [address (InetAddress/getByName host)
        socket (ServerSocket. (int port) 50 address)
        executor (Executors/newCachedThreadPool)
        alive (atom true)
        accept-loop (Thread.
                     (fn []
                       (while @alive
                         (try
                           (let [client (.accept socket)]
                             (.submit executor
                                      ^Runnable
                                      (fn []
                                        (with-open [client client]
                                          (try
                                            (when-let [request (read-request client)]
                                              (write-response! client (handler request)))
                                            (catch Throwable error
                                              (try (write-response! client {:status 400 :body "bad request"})
                                                   (catch Throwable _))))))))
                           (catch java.net.SocketException _ (reset! alive false)))))
                     "patrol-http-accept")]
    (.setDaemon accept-loop true)
    (.start accept-loop)
    {:socket socket :executor executor :alive alive :thread accept-loop :port (.getLocalPort socket)}))

(defn stop! [{:keys [socket executor alive]}]
  (reset! alive false)
  (.close socket)
  (.shutdownNow executor)
  (.awaitTermination executor 2 TimeUnit/SECONDS))
