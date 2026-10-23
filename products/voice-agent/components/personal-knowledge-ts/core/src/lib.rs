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

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
mod browser_abi {
    use super::{decode_journal, JOURNAL_QUERY};
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
        let output = serde_json::to_vec(&result)
            .unwrap_or_else(|_| b"{\"error\":\"encoding failed\"}".to_vec());
        let output = output.into_boxed_slice();
        let output_length = output.len() as u32;
        let output_pointer = Box::into_raw(output) as *mut u8 as u32;
        ((output_pointer as u64) << 32) | output_length as u64
    }

    #[no_mangle]
    pub unsafe extern "C" fn free_output(pointer: u32, length: u32) {
        let slice = slice::from_raw_parts_mut(pointer as *mut u8, length as usize);
        drop(Box::from_raw(slice));
    }
}

#[cfg(test)]
mod tests {
    use super::decode_journal;

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
}
