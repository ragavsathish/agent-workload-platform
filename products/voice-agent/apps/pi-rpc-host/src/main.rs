mod telemetry;

use opentelemetry::{Context, KeyValue};
use serde_json::{json, Map, Value};
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const MAX_COMMAND_BYTES: u64 = 65_536;
const MAX_CLIENTS: usize = 4;
const MAX_MESSAGE_CHARS: usize = 20_000;
const MAX_RESPONSE_TEXT_CHARS: usize = 24_000;
const MAX_SOCKET_PATH_BYTES: usize = 100;
const CLIENT_WRITE_TIMEOUT: Duration = Duration::from_millis(500);

struct Options {
    socket_dir: PathBuf,
    task_id: String,
    idle: Duration,
    timeout: Duration,
    command: Vec<String>,
}

struct Client {
    stream: Mutex<UnixStream>,
    alive: AtomicBool,
}

struct AcceptState {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    clients: Arc<Mutex<Vec<Arc<Client>>>>,
    active: Arc<AtomicUsize>,
    activity: Arc<Mutex<Instant>>,
    settled: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    telemetry: telemetry::Telemetry,
    parent: Context,
    client_threads: Arc<Mutex<Vec<thread::JoinHandle<()>>>>,
}

struct ChildGuard(Child);

impl std::ops::Deref for ChildGuard {
    type Target = Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for ChildGuard {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

struct SocketGuard(PathBuf);

impl Drop for SocketGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn main() {
    let telemetry_runtime = telemetry::TelemetryRuntime::configure();
    let result = run(&telemetry_runtime.telemetry);
    telemetry_runtime.shutdown();
    if let Err(error) = result {
        eprintln!("pi-task-rpc: {error}");
        std::process::exit(1);
    }
}

fn run(telemetry: &telemetry::Telemetry) -> Result<(), String> {
    let options = parse_args()?;
    validate_task_id(&options.task_id)?;
    let mut session_operation = telemetry.session(&options.task_id);
    let session_context = session_operation.context();
    let mut initial_prompt = String::new();
    io::stdin()
        .read_to_string(&mut initial_prompt)
        .map_err(|error| format!("cannot read initial prompt: {error}"))?;
    if initial_prompt.trim().is_empty() || initial_prompt.chars().count() > MAX_MESSAGE_CHARS {
        return Err("initial prompt is empty or too large".into());
    }
    telemetry.event(&session_context, "startup.prompt_read", "ok");

    prepare_socket_dir(&options.socket_dir)?;
    let socket_path = options.socket_dir.join(format!("{}.sock", options.task_id));
    validate_socket_path(&socket_path)?;
    if socket_path.exists() {
        fs::remove_file(&socket_path).map_err(|error| format!("cannot replace socket: {error}"))?;
    }

    let listener = UnixListener::bind(&socket_path)
        .map_err(|error| format!("cannot bind {}: {error}", socket_path.display()))?;
    let _socket_guard = SocketGuard(socket_path.clone());
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("cannot protect socket: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("cannot configure socket: {error}"))?;
    telemetry.event(&session_context, "startup.socket_ready", "ok");

    let mut child = ChildGuard(
        Command::new(&options.command[0])
            .args(&options.command[1..])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("cannot start Pi: {error}"))?,
    );
    telemetry.event(&session_context, "startup.pi_spawned", "ok");
    let child_stdin = Arc::new(Mutex::new(child.stdin.take()));
    let child_stdout = child.stdout.take().ok_or("Pi stdout is unavailable")?;
    send_command(
        &child_stdin,
        &json!({"id":"initial-task","type":"prompt","message":initial_prompt}),
    )?;
    telemetry.event(&session_context, "startup.prompt_sent", "ok");

    let stopping = Arc::new(AtomicBool::new(false));
    let settled = Arc::new(AtomicBool::new(false));
    let active_clients = Arc::new(AtomicUsize::new(0));
    let clients: Arc<Mutex<Vec<Arc<Client>>>> = Arc::new(Mutex::new(Vec::new()));
    let client_threads = Arc::new(Mutex::new(Vec::new()));
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let accept_thread = spawn_accept_loop(
        listener,
        options.task_id.clone(),
        AcceptState {
            stdin: Arc::clone(&child_stdin),
            clients: Arc::clone(&clients),
            active: Arc::clone(&active_clients),
            activity: Arc::clone(&last_activity),
            settled: Arc::clone(&settled),
            stopping: Arc::clone(&stopping),
            telemetry: telemetry.clone(),
            parent: session_context.clone(),
            client_threads: Arc::clone(&client_threads),
        },
    );

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(child_stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    if sender.send(line).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    let deadline = Instant::now() + options.timeout;
    let mut initial_settled = false;
    let mut first_record_seen = false;
    let mut protocol_error = None;
    while Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(line) => {
                *last_activity.lock().expect("activity lock") = Instant::now();
                let record: Value = match serde_json::from_str(&line) {
                    Ok(value) => value,
                    Err(_) => {
                        telemetry.event(&session_context, "pi.record", "invalid");
                        continue;
                    }
                };
                if !first_record_seen {
                    first_record_seen = true;
                    telemetry.event(&session_context, "startup.first_record", "ok");
                }
                if !initial_settled {
                    print!("{line}");
                    io::stdout().flush().map_err(|error| error.to_string())?;
                }
                if record.get("type") == Some(&Value::String("agent_settled".into())) {
                    settled.store(true, Ordering::Release);
                    initial_settled = true;
                    telemetry.event(&session_context, "pi.settled", "ok");
                }
                if let Some(public) = public_record(&record) {
                    broadcast(&clients, &public);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            if !status.success() {
                protocol_error = Some(format!("Pi exited with {status}"));
            }
            break;
        }
        let idle_for = last_activity.lock().expect("activity lock").elapsed();
        if initial_settled
            && settled.load(Ordering::Acquire)
            && active_clients.load(Ordering::Acquire) == 0
            && idle_for >= options.idle
        {
            child_stdin.lock().expect("stdin lock").take();
            break;
        }
    }
    if Instant::now() >= deadline {
        protocol_error = Some("Pi RPC session timed out".into());
        session_operation.set_outcome("timeout");
    }

    stopping.store(true, Ordering::Release);
    child_stdin.lock().expect("stdin lock").take();
    for client in clients.lock().expect("clients lock").iter() {
        client.alive.store(false, Ordering::Release);
        let _ = client
            .stream
            .lock()
            .expect("client lock")
            .shutdown(std::net::Shutdown::Both);
    }
    for _ in 0..50 {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_none()
    {
        child.kill().map_err(|error| error.to_string())?;
    }
    let status = child.wait().map_err(|error| error.to_string())?;
    let _ = accept_thread.join();
    let handles = std::mem::take(&mut *client_threads.lock().expect("client threads lock"));
    for handle in handles {
        let _ = handle.join();
    }
    if !initial_settled {
        return Err(
            protocol_error.unwrap_or_else(|| "Pi ended before the initial task settled".into())
        );
    }
    if !status.success() && protocol_error.is_none() {
        return Err(format!("Pi exited with {status}"));
    }
    if let Some(error) = protocol_error {
        return Err(error);
    }
    session_operation.finish("ok");
    Ok(())
}

fn parse_args() -> Result<Options, String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let separator = args
        .iter()
        .position(|value| value == "--")
        .ok_or("missing -- before Pi command")?;
    let command = args[separator + 1..].to_vec();
    if command.is_empty() {
        return Err("missing Pi command".into());
    }
    let mut socket_dir = None;
    let mut task_id = None;
    let mut idle = None;
    let mut timeout = None;
    let mut index = 0;
    while index < separator {
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("missing value for {}", args[index]))?;
        match args[index].as_str() {
            "--socket-dir" => socket_dir = Some(PathBuf::from(value)),
            "--task-id" => task_id = Some(value.clone()),
            "--idle-seconds" => idle = Some(parse_duration(value, "idle")?),
            "--timeout-seconds" => timeout = Some(parse_duration(value, "timeout")?),
            other => return Err(format!("unknown argument: {other}")),
        }
        index += 2;
    }
    Ok(Options {
        socket_dir: socket_dir.ok_or("missing --socket-dir")?,
        task_id: task_id.ok_or("missing --task-id")?,
        idle: idle.ok_or("missing --idle-seconds")?,
        timeout: timeout.ok_or("missing --timeout-seconds")?,
        command,
    })
}

fn parse_duration(value: &str, name: &str) -> Result<Duration, String> {
    let seconds: f64 = value
        .parse()
        .map_err(|_| format!("invalid {name} seconds"))?;
    if !seconds.is_finite() || seconds < 0.0 {
        return Err(format!("invalid {name} seconds"));
    }
    Ok(Duration::from_secs_f64(seconds))
}

fn validate_task_id(value: &str) -> Result<(), String> {
    if value.len() != 36
        || value.bytes().filter(|byte| *byte == b'-').count() != 4
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte == b'-')
    {
        return Err("task ID must be a lowercase UUID".into());
    }
    Ok(())
}

fn prepare_socket_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| format!("cannot create socket directory: {error}"))?;
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err("socket directory must be an owner-controlled directory".into());
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| error.to_string())
}

fn validate_socket_path(path: &Path) -> Result<(), String> {
    let length = path.as_os_str().as_bytes().len();
    if length > MAX_SOCKET_PATH_BYTES {
        return Err(format!(
            "Unix socket path is {length} bytes; configure a path no longer than {MAX_SOCKET_PATH_BYTES} bytes"
        ));
    }
    Ok(())
}

fn send_command(stdin: &Arc<Mutex<Option<ChildStdin>>>, command: &Value) -> Result<(), String> {
    let mut guard = stdin.lock().map_err(|_| "Pi stdin lock failed")?;
    let target = guard.as_mut().ok_or("Pi stdin is closed")?;
    serde_json::to_writer(&mut *target, command).map_err(|error| error.to_string())?;
    target.write_all(b"\n").map_err(|error| error.to_string())?;
    target.flush().map_err(|error| error.to_string())
}

fn spawn_accept_loop(
    listener: UnixListener,
    task_id: String,
    state: AcceptState,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        while !state.stopping.load(Ordering::Acquire) {
            match listener.accept() {
                Ok((stream, _)) => {
                    if state.active.load(Ordering::Acquire) >= MAX_CLIENTS {
                        state
                            .telemetry
                            .event(&state.parent, "client.attach", "capacity");
                        let _ = stream.shutdown(std::net::Shutdown::Both);
                        continue;
                    }
                    if stream.set_nonblocking(false).is_err() {
                        continue;
                    }
                    if stream
                        .set_write_timeout(Some(CLIENT_WRITE_TIMEOUT))
                        .is_err()
                    {
                        continue;
                    }
                    let reader = match stream.try_clone() {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    let client = Arc::new(Client {
                        stream: Mutex::new(stream),
                        alive: AtomicBool::new(true),
                    });
                    let attached = json!({"type":"remote_attached","taskId":task_id});
                    if write_record(&client, &attached).is_err() {
                        state
                            .telemetry
                            .event(&state.parent, "client.attach", "socket_error");
                        continue;
                    }
                    state.active.fetch_add(1, Ordering::AcqRel);
                    *state.activity.lock().expect("activity lock") = Instant::now();
                    state
                        .clients
                        .lock()
                        .expect("clients lock")
                        .push(Arc::clone(&client));
                    let stdin = Arc::clone(&state.stdin);
                    let active = Arc::clone(&state.active);
                    let activity = Arc::clone(&state.activity);
                    let settled = Arc::clone(&state.settled);
                    let telemetry = state.telemetry.clone();
                    let parent = state.parent.clone();
                    let handle = thread::spawn(move || {
                        let client_operation = telemetry.start(
                            &parent,
                            "client.attached",
                            vec![KeyValue::new(
                                "client.active",
                                active.load(Ordering::Acquire) as i64,
                            )],
                        );
                        let client_context = client_operation.context();
                        let mut client_outcome = "ok";
                        let mut reader = BufReader::new(reader);
                        loop {
                            let mut bytes = Vec::new();
                            match reader
                                .by_ref()
                                .take(MAX_COMMAND_BYTES + 1)
                                .read_until(b'\n', &mut bytes)
                            {
                                Ok(0) | Err(_) => break,
                                Ok(_)
                                    if bytes.len() as u64 > MAX_COMMAND_BYTES
                                        || !bytes.ends_with(b"\n") =>
                                {
                                    telemetry.event(
                                        &client_context,
                                        "command.receive",
                                        "oversized",
                                    );
                                    client_outcome = "invalid";
                                    break;
                                }
                                Ok(_) => {}
                            }
                            let command: Value = match serde_json::from_slice(&bytes) {
                                Ok(value) => value,
                                Err(_) => {
                                    telemetry.event(
                                        &client_context,
                                        "command.receive",
                                        "invalid_json",
                                    );
                                    client_outcome = "invalid";
                                    break;
                                }
                            };
                            let command = match validate_command(&command) {
                                Ok(value) => value,
                                Err(_) => {
                                    telemetry.event(&client_context, "command.receive", "rejected");
                                    client_outcome = "rejected";
                                    break;
                                }
                            };
                            let command_kind = command
                                .get("type")
                                .and_then(Value::as_str)
                                .expect("validated command type");
                            let command_operation = telemetry.start(
                                &client_context,
                                "command",
                                vec![KeyValue::new("rpc.command", command_kind.to_owned())],
                            );
                            if matches!(
                                command.get("type").and_then(Value::as_str),
                                Some("abort" | "follow_up" | "prompt" | "steer")
                            ) {
                                settled.store(false, Ordering::Release);
                            }
                            if send_command(&stdin, &command).is_err() {
                                command_operation.finish("pi_unavailable");
                                client_outcome = "pi_unavailable";
                                break;
                            }
                            command_operation.finish("ok");
                            *activity.lock().expect("activity lock") = Instant::now();
                        }
                        client.alive.store(false, Ordering::Release);
                        active.fetch_sub(1, Ordering::AcqRel);
                        *activity.lock().expect("activity lock") = Instant::now();
                        client_operation.finish(client_outcome);
                    });
                    state
                        .client_threads
                        .lock()
                        .expect("client threads lock")
                        .push(handle);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(_) => break,
            }
        }
    })
}

fn validate_command(value: &Value) -> Result<Value, String> {
    let object = value.as_object().ok_or("command must be an object")?;
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or("missing command type")?;
    let mut allowed = vec!["id", "type"];
    if matches!(kind, "follow_up" | "prompt" | "steer") {
        allowed.push("message");
    }
    if kind == "prompt" {
        allowed.push("streamingBehavior");
    }
    if !matches!(
        kind,
        "abort" | "follow_up" | "get_last_assistant_text" | "get_state" | "prompt" | "steer"
    ) || object.keys().any(|key| !allowed.contains(&key.as_str()))
    {
        return Err("unsupported Pi RPC command".into());
    }
    if let Some(id) = object.get("id") {
        if id
            .as_str()
            .filter(|value| !value.is_empty() && value.len() <= 128)
            .is_none()
        {
            return Err("invalid request ID".into());
        }
    }
    if matches!(kind, "follow_up" | "prompt" | "steer") {
        let message = object
            .get("message")
            .and_then(Value::as_str)
            .ok_or("missing message")?;
        if message.trim().is_empty() || message.chars().count() > MAX_MESSAGE_CHARS {
            return Err("invalid message".into());
        }
    }
    if kind == "prompt" {
        if let Some(behavior) = object.get("streamingBehavior") {
            if !matches!(behavior.as_str(), Some("steer" | "followUp")) {
                return Err("invalid streaming behavior".into());
            }
        }
    }
    Ok(value.clone())
}

fn public_record(record: &Value) -> Option<Value> {
    let kind = record.get("type")?.as_str()?;
    match kind {
        "agent_settled" | "turn_start" | "turn_end" => Some(json!({"type":kind})),
        "message_update" => {
            let event = record.get("assistantMessageEvent")?;
            if event.get("type")?.as_str()? != "text_delta" {
                return None;
            }
            Some(
                json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":event.get("delta")?.as_str()?}}),
            )
        }
        "response" => {
            let mut public = Map::new();
            for field in ["id", "type", "command", "success"] {
                if let Some(value) = record.get(field) {
                    public.insert(field.into(), value.clone());
                }
            }
            if let Some(error) = record.get("error").and_then(Value::as_str) {
                public.insert(
                    "error".into(),
                    Value::String(error.chars().take(1000).collect()),
                );
            }
            if let Some(data) = record.get("data") {
                match record.get("command").and_then(Value::as_str) {
                    Some("get_state") => {
                        public.insert("data".into(), json!({"isStreaming":data.get("isStreaming").and_then(Value::as_bool).unwrap_or(false),"messageCount":data.get("messageCount").and_then(Value::as_u64).unwrap_or(0)}));
                    }
                    Some("get_last_assistant_text") => {
                        public.insert("data".into(), json!({"text":data.get("text").and_then(Value::as_str).map(|text| text.chars().take(MAX_RESPONSE_TEXT_CHARS).collect::<String>())}));
                    }
                    _ => {}
                }
            }
            Some(Value::Object(public))
        }
        _ => None,
    }
}

fn write_record(client: &Client, record: &Value) -> io::Result<()> {
    let mut stream = client.stream.lock().expect("client lock");
    serde_json::to_writer(&mut *stream, record)?;
    stream.write_all(b"\n")
}

fn broadcast(clients: &Arc<Mutex<Vec<Arc<Client>>>>, record: &Value) {
    let mut clients = clients.lock().expect("clients lock");
    clients.retain(|client| {
        client.alive.load(Ordering::Acquire) && write_record(client, record).is_ok()
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_interface_is_conversational_and_bounded() {
        assert!(validate_command(&json!({"id":"one","type":"get_state"})).is_ok());
        assert!(validate_command(&json!({"id":"two","type":"prompt","message":"Explain"})).is_ok());
        assert!(validate_command(&json!({"id":"bad","type":"set_model","model":"other"})).is_err());
        assert!(validate_command(&json!({"id":"bad","type":"prompt","message":""})).is_err());
    }

    #[test]
    fn socket_path_rejects_non_portable_lengths() {
        assert!(validate_socket_path(Path::new("/tmp/task.sock")).is_ok());
        let long = format!("/tmp/{}/task.sock", "x".repeat(MAX_SOCKET_PATH_BYTES));
        assert!(validate_socket_path(Path::new(&long)).is_err());
    }

    #[test]
    fn public_projection_excludes_reasoning_tools_and_private_state() {
        assert!(public_record(&json!({
            "type":"message_update",
            "assistantMessageEvent":{"type":"thinking_delta","delta":"private"}
        }))
        .is_none());
        assert!(public_record(&json!({
            "type":"tool_execution_start",
            "args":{"secret":"value"}
        }))
        .is_none());
        let projected = public_record(&json!({
            "id":"state",
            "type":"response",
            "command":"get_state",
            "success":true,
            "data":{"isStreaming":false,"messageCount":3,"sessionFile":"private"}
        }))
        .expect("state projection");
        assert_eq!(
            projected["data"],
            json!({"isStreaming":false,"messageCount":3})
        );
    }
}
