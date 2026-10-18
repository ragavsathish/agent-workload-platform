use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixStream;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

fn temp_root(label: &str) -> std::path::PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::path::PathBuf::from(format!(
        "/tmp/{label}-{}-{}",
        std::process::id(),
        nonce % 1_000_000
    ))
}

#[test]
fn supervises_pi_and_exposes_only_public_rpc_records() {
    let root = temp_root("prh");
    fs::create_dir(&root).expect("temp directory");
    let fake_pi = root.join("fake-pi.py");
    fs::write(
        &fake_pi,
        r#"#!/usr/bin/env python3
import json, sys, time
initial = json.loads(sys.stdin.readline())
time.sleep(0.2)
print(json.dumps({"id": initial["id"], "type": "response", "command": "prompt", "success": True}), flush=True)
print(json.dumps({"type": "message_update", "assistantMessageEvent": {"type": "thinking_delta", "delta": "private"}}), flush=True)
print(json.dumps({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": "Public"}}), flush=True)
answer = {"spoken": "Done.", "presentation": {"kind": "status", "title": "Done", "nodes": [], "edges": []}}
print(json.dumps({"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": json.dumps(answer)}]}}), flush=True)
print(json.dumps({"type": "agent_settled"}), flush=True)
for line in sys.stdin:
    command = json.loads(line)
    if command["type"] == "get_state":
        print(json.dumps({"id": command["id"], "type": "response", "command": "get_state", "success": True, "data": {"isStreaming": False, "messageCount": 2, "sessionFile": "private"}}), flush=True)
"#,
    )
    .expect("fake Pi");
    fs::set_permissions(&fake_pi, fs::Permissions::from_mode(0o700)).expect("permissions");
    let task_id = "00000000-0000-0000-0000-000000000001";
    let socket = root.join(format!("{task_id}.sock"));
    let mut child = Command::new(env!("CARGO_BIN_EXE_pi-task-rpc"))
        .args([
            "--socket-dir",
            root.to_str().expect("root path"),
            "--task-id",
            task_id,
            "--idle-seconds",
            "0.1",
            "--timeout-seconds",
            "5",
            "--",
            "/usr/bin/env",
            "python3",
            fake_pi.to_str().expect("fake path"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("RPC host");
    child
        .stdin
        .take()
        .expect("host stdin")
        .write_all(b"Initial task")
        .expect("initial prompt");

    let deadline = Instant::now() + Duration::from_secs(2);
    let stream = loop {
        match UnixStream::connect(&socket) {
            Ok(stream) => break stream,
            Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Err(error) => panic!("cannot connect to RPC socket: {error}"),
        }
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("read timeout");
    let mut reader = BufReader::new(stream.try_clone().expect("socket clone"));
    let mut attached = String::new();
    reader.read_line(&mut attached).expect("attachment");
    assert!(attached.contains("remote_attached"));

    let invalid_stream = UnixStream::connect(&socket).expect("second client");
    invalid_stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("second client timeout");
    let mut invalid_reader = BufReader::new(invalid_stream.try_clone().expect("second clone"));
    let mut invalid_attached = String::new();
    invalid_reader
        .read_line(&mut invalid_attached)
        .expect("second attachment");
    assert!(invalid_attached.contains("remote_attached"));
    (&invalid_stream)
        .write_all(b"{\"id\":\"bad\",\"type\":\"set_model\"}\n")
        .expect("invalid command");
    let mut closed = String::new();
    assert_eq!(
        invalid_reader
            .read_line(&mut closed)
            .expect("closed client"),
        0
    );

    (&stream)
        .write_all(b"{\"id\":\"state\",\"type\":\"get_state\"}\n")
        .expect("state command");
    let mut records = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).expect("public record");
        let record: Value = serde_json::from_str(&line).expect("JSONL record");
        let done = record.get("id").and_then(Value::as_str) == Some("state");
        records.push(record);
        if done {
            break;
        }
    }
    let serialized = serde_json::to_string(&records).expect("records");
    assert!(serialized.contains("Public"));
    assert!(!serialized.contains("private"));
    drop(reader);
    drop(stream);

    let output = child.wait_with_output().expect("host output");
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("agent_settled"));
    fs::remove_dir_all(root).expect("remove temp directory");
}

#[test]
fn removes_socket_when_pi_cannot_start() {
    let root = temp_root("prh-fail");
    fs::create_dir(&root).expect("temp directory");
    let task_id = "00000000-0000-0000-0000-000000000002";
    let socket = root.join(format!("{task_id}.sock"));
    let mut child = Command::new(env!("CARGO_BIN_EXE_pi-task-rpc"))
        .args([
            "--socket-dir",
            root.to_str().expect("root path"),
            "--task-id",
            task_id,
            "--idle-seconds",
            "0.1",
            "--timeout-seconds",
            "1",
            "--",
            "/definitely/missing/pi-rpc-command",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("RPC host");
    child
        .stdin
        .take()
        .expect("host stdin")
        .write_all(b"Initial task")
        .expect("initial prompt");

    let output = child.wait_with_output().expect("host output");
    assert!(!output.status.success());
    assert!(!socket.exists());
    fs::remove_dir_all(root).expect("remove temp directory");
}
