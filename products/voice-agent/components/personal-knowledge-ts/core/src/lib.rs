use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const JOURNAL_QUERY: &str = include_str!("../journal.rq");
const MAX_RESPONSE_BYTES: usize = 2_000_000;
const MAX_BINDINGS: usize = 8_000;
const ENTRY_KINDS: [&str; 6] = [
    "thought", "idea", "question", "decision", "goal", "learning",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub id: String,
    pub text: String,
    pub kind: String,
    pub created_at: String,
    pub source_id: String,
    pub source_label: String,
    pub transcript: String,
    pub topics: Vec<String>,
}

#[derive(Deserialize)]
struct ResultsDocument {
    results: Results,
}

#[derive(Deserialize)]
struct Results {
    bindings: Vec<HashMap<String, Term>>,
}

#[derive(Deserialize)]
struct Term {
    value: String,
}

fn binding<'a>(row: &'a HashMap<String, Term>, key: &str) -> Option<&'a str> {
    row.get(key).map(|term| term.value.as_str())
}

pub fn decode_journal(payload: &str) -> Result<Vec<JournalEntry>, String> {
    if payload.len() > MAX_RESPONSE_BYTES {
        return Err("journal response is too large".to_string());
    }
    let document: ResultsDocument = serde_json::from_str(payload)
        .map_err(|_| "Oxigraph returned invalid SPARQL JSON".to_string())?;
    if document.results.bindings.len() > MAX_BINDINGS {
        return Err("journal response contains too many rows".to_string());
    }

    let mut entries = Vec::<JournalEntry>::new();
    let mut indexes = HashMap::<String, usize>::new();
    for row in document.results.bindings {
        let (Some(id), Some(text), Some(kind), Some(created_at), Some(source_id)) = (
            binding(&row, "id"),
            binding(&row, "text"),
            binding(&row, "kind"),
            binding(&row, "createdAt"),
            binding(&row, "sourceId"),
        ) else {
            continue;
        };
        let kind = kind.to_lowercase();
        if !ENTRY_KINDS.contains(&kind.as_str()) || created_at.len() < 10 {
            continue;
        }

        let index = *indexes.entry(id.to_string()).or_insert_with(|| {
            entries.push(JournalEntry {
                id: id.to_string(),
                text: text.to_string(),
                kind,
                created_at: created_at.to_string(),
                source_id: source_id.to_string(),
                source_label: binding(&row, "sourceLabel")
                    .map(str::to_string)
                    .unwrap_or_else(|| created_at.chars().take(10).collect()),
                transcript: binding(&row, "transcript")
                    .map(str::to_string)
                    .unwrap_or_else(|| "Source transcript is unavailable.".to_string()),
                topics: Vec::new(),
            });
            entries.len() - 1
        });
        if let Some(topic) = binding(&row, "topic") {
            let entry = &mut entries[index];
            if !entry.topics.iter().any(|existing| existing == topic) {
                entry.topics.push(topic.to_string());
            }
        }
    }
    Ok(entries)
}

fn valid_entry_id(id: &str) -> bool {
    let Some((capture, index)) = id.split_once(":entry:") else {
        return false;
    };
    capture.len() == 32
        && capture
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && !index.is_empty()
        && !index.starts_with('0')
        && index.bytes().all(|b| b.is_ascii_digit())
}

pub fn encode_journal_feedback(payload: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| "invalid feedback JSON")?;
    let id = value["entryId"].as_str().ok_or("missing entry ID")?;
    if !valid_entry_id(id) {
        return Err("invalid entry ID".into());
    }
    let action = value["action"].as_str().ok_or("missing feedback action")?;
    if action != "edit" && action != "delete" {
        return Err("invalid feedback action".into());
    }
    if action == "delete" {
        return Ok(serde_json::json!({"action":"delete"}).to_string());
    }
    let content = value["correctedText"]
        .as_str()
        .ok_or("missing corrected text")?
        .trim();
    if content.is_empty() || content.chars().count() > 1000 {
        return Err("corrected text must be 1–1000 characters".into());
    }
    let kind = value["correctedType"]
        .as_str()
        .ok_or("missing corrected type")?;
    if !ENTRY_KINDS.contains(&kind) {
        return Err("invalid corrected type".into());
    }
    let topics = value["correctedTopics"]
        .as_array()
        .ok_or("missing corrected topics")?;
    if topics.len() > 12 {
        return Err("too many topics".into());
    }
    let mut clean = Vec::<String>::new();
    for topic in topics {
        let topic = topic.as_str().ok_or("invalid topic")?.trim();
        if topic.is_empty() || topic.chars().count() > 80 || clean.iter().any(|item| item == topic)
        {
            return Err("invalid or duplicate topic".into());
        }
        clean.push(topic.to_string());
    }
    Ok(serde_json::json!({"action":"edit","correctedText":content,"correctedType":kind,"correctedTopics":clean}).to_string())
}

pub fn encode_assertion_review(payload: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(payload).map_err(|_| "invalid assertion review JSON")?;
    let id = value["entryId"].as_str().ok_or("missing entry ID")?;
    if !valid_entry_id(id) {
        return Err("invalid entry ID".into());
    }
    let authored = value["ownerAuthored"]
        .as_bool()
        .ok_or("missing authorship decision")?;
    let reason = value["reason"]
        .as_str()
        .ok_or("missing review reason")?
        .trim();
    if reason.chars().count() < 3 || reason.chars().count() > 500 {
        return Err("review reason must be 3–500 characters".into());
    }
    if !authored {
        return Ok(serde_json::json!({"ownerAuthored":false,"reason":reason}).to_string());
    }
    let kind = value["expectedKind"]
        .as_str()
        .ok_or("missing assertion kind")?;
    if ![
        "none",
        "conversation_topic",
        "skill_evidence",
        "profile_update",
    ]
    .contains(&kind)
    {
        return Err("invalid assertion kind".into());
    }
    let field = value["expectedProfileField"].as_str().unwrap_or("none");
    if kind == "profile_update" {
        if !["job_title", "home_location", "credential", "employment"].contains(&field) {
            return Err("invalid profile field".into());
        }
    } else if field != "none" {
        return Err("profile field requires profile update".into());
    }
    Ok(serde_json::json!({"ownerAuthored":true,"expectedKind":kind,"expectedProfileField":field,"reason":reason}).to_string())
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
mod browser_abi {
    use super::{decode_journal, encode_assertion_review, encode_journal_feedback, JOURNAL_QUERY};
    use serde_json::json;
    use std::slice;

    #[no_mangle]
    pub extern "C" fn journal_query_ptr() -> u32 {
        JOURNAL_QUERY.as_ptr() as u32
    }

    #[no_mangle]
    pub extern "C" fn journal_query_len() -> u32 {
        JOURNAL_QUERY.len() as u32
    }

    #[no_mangle]
    pub extern "C" fn alloc_input(length: u32) -> u32 {
        let buffer = vec![0_u8; length as usize].into_boxed_slice();
        Box::into_raw(buffer) as *mut u8 as u32
    }

    #[no_mangle]
    pub unsafe extern "C" fn free_input(pointer: u32, length: u32) {
        let slice = slice::from_raw_parts_mut(pointer as *mut u8, length as usize);
        drop(Box::from_raw(slice));
    }

    #[no_mangle]
    pub unsafe extern "C" fn decode_journal_json(pointer: u32, length: u32) -> u64 {
        let input = slice::from_raw_parts(pointer as *const u8, length as usize);
        let payload = std::str::from_utf8(input)
            .map_err(|_| "journal result is not UTF-8".to_string())
            .and_then(decode_journal);
        let result = match payload {
            Ok(entries) => json!({ "ok": entries }),
            Err(error) => json!({ "error": error }),
        };
        return encode_output(result);
    }

    unsafe fn encode_output(result: serde_json::Value) -> u64 {
        let output = serde_json::to_vec(&result)
            .unwrap_or_else(|_| b"{\"error\":\"encoding failed\"}".to_vec());
        let output = output.into_boxed_slice();
        let output_length = output.len() as u32;
        let output_pointer = Box::into_raw(output) as *mut u8 as u32;
        ((output_pointer as u64) << 32) | output_length as u64
    }

    unsafe fn encode_command(
        pointer: u32,
        length: u32,
        encoder: fn(&str) -> Result<String, String>,
    ) -> u64 {
        if length > 4096 {
            return encode_output(json!({"error":"command is too large"}));
        }
        let input = slice::from_raw_parts(pointer as *const u8, length as usize);
        let result = std::str::from_utf8(input)
            .map_err(|_| "command is not UTF-8".to_string())
            .and_then(encoder);
        match result {
            Ok(body) => encode_output(json!({"ok": body})),
            Err(error) => encode_output(json!({"error":error})),
        }
    }

    #[no_mangle]
    pub unsafe extern "C" fn encode_journal_feedback_json(pointer: u32, length: u32) -> u64 {
        encode_command(pointer, length, encode_journal_feedback)
    }

    #[no_mangle]
    pub unsafe extern "C" fn encode_assertion_review_json(pointer: u32, length: u32) -> u64 {
        encode_command(pointer, length, encode_assertion_review)
    }

    #[no_mangle]
    pub unsafe extern "C" fn free_output(pointer: u32, length: u32) {
        let slice = slice::from_raw_parts_mut(pointer as *mut u8, length as usize);
        drop(Box::from_raw(slice));
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_journal, encode_assertion_review, encode_journal_feedback};

    #[test]
    fn groups_topic_rows_into_one_journal_entry() {
        let payload = r#"{"results":{"bindings":[
          {"id":{"value":"n1"},"kind":{"value":"IDEA"},"text":{"value":"A note"},"createdAt":{"value":"2026-10-22T10:00:00Z"},"sourceId":{"value":"s1"},"topic":{"value":"Graph"}},
          {"id":{"value":"n1"},"kind":{"value":"idea"},"text":{"value":"A note"},"createdAt":{"value":"2026-10-22T10:00:00Z"},"sourceId":{"value":"s1"},"topic":{"value":"Journal"}},
          {"id":{"value":"n1"},"kind":{"value":"idea"},"text":{"value":"A note"},"createdAt":{"value":"2026-10-22T10:00:00Z"},"sourceId":{"value":"s1"},"topic":{"value":"Graph"}}
        ]}}"#;

        let entries = decode_journal(payload).expect("valid Oxigraph results");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].kind, "idea");
        assert_eq!(entries[0].topics, ["Graph", "Journal"]);
    }

    #[test]
    fn rejects_invalid_and_oversized_responses() {
        assert!(decode_journal("not json").is_err());
        assert_eq!(
            decode_journal(&" ".repeat(2_000_001)).unwrap_err(),
            "journal response is too large"
        );
    }

    #[test]
    fn encodes_only_bounded_journal_edits() {
        let id = format!("{}:entry:1", "a".repeat(32));
        let payload = serde_json::json!({"entryId":id,"action":"edit","correctedText":"A/B","correctedType":"idea","correctedTopics":["Graph","Learning"],"identity":"attacker@example.com"});
        let result = encode_journal_feedback(&payload.to_string()).unwrap();
        assert!(!result.contains("identity"));
        assert!(result.contains("A/B"));
        assert!(encode_journal_feedback(&serde_json::json!({"entryId":id,"action":"edit","correctedText":"X","correctedType":"idea","correctedTopics":["Graph","Graph"]}).to_string()).is_err());
        assert!(encode_journal_feedback(
            &serde_json::json!({"entryId":"bad","action":"delete"}).to_string()
        )
        .is_err());
    }

    #[test]
    fn assertion_review_requires_authorship_and_consistent_profile_field() {
        let id = format!("{}:entry:1", "a".repeat(32));
        assert!(encode_assertion_review(&serde_json::json!({"entryId":id,"ownerAuthored":false,"expectedKind":"skill_evidence","reason":"Not owner"}).to_string()).unwrap().contains("\"ownerAuthored\":false"));
        assert!(encode_assertion_review(&serde_json::json!({"entryId":id,"ownerAuthored":true,"expectedKind":"profile_update","reason":"Owner said it"}).to_string()).is_err());
    }
}
