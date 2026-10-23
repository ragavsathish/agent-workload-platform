use spin_sdk::http::{send, Method, Request, Response};
use voice::personal_knowledge::types;

wit_bindgen::generate!({
    generate_all,
    path: "wit",
    world: "gateway-http",
});

const MAX_GATEWAY_RESPONSE_BYTES: usize = 64_000;
const MAX_JOURNAL_RESPONSE_BYTES: usize = 2_000_000;

struct GatewayHttp;

fn required(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

fn gateway_url(path: &str, identity: &str) -> Result<String, String> {
    if !path.starts_with("/digital-twin?") || path.starts_with("//") {
        return Err("personal knowledge path is not allowed".to_string());
    }
    let base = required("KNOWLEDGE_GATEWAY_BASE_URL")?;
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("KNOWLEDGE_GATEWAY_BASE_URL must use HTTP or HTTPS".to_string());
    }
    Ok(format!(
        "{}{}&identity={}",
        base.trim_end_matches('/'),
        path,
        urlencoding::encode(identity)
    ))
}

impl Guest for GatewayHttp {
    fn request(path: String, body: String) -> Result<String, String> {
        spin_executor::run(async move {
            if !body.is_empty() {
                return Err("gateway knowledge requests do not accept a body".to_string());
            }
            let identity = required("KNOWLEDGE_IDENTITY")?;
            let token = required("KNOWLEDGE_GATEWAY_TOKEN")?;
            let request = Request::builder()
                .method(Method::Get)
                .uri(gateway_url(&path, &identity)?)
                .header("authorization", format!("Bearer {token}"))
                .build();
            let response: Response = send(request).await.map_err(|error| error.to_string())?;
            if response.body().len() > MAX_GATEWAY_RESPONSE_BYTES {
                return Err("personal knowledge response is too large".to_string());
            }
            if !(200..300).contains(response.status()) {
                return Err(format!(
                    "personal knowledge gateway rejected the request with {}",
                    response.status()
                ));
            }
            String::from_utf8(response.body().to_vec())
                .map_err(|_| "personal knowledge gateway returned non-UTF-8 data".to_string())
        })
    }

    fn journal_query() -> Result<Vec<types::JournalEntry>, String> {
        spin_executor::run(async move {
            let url = required("OXIGRAPH_QUERY_URL")?;
            if !(url.starts_with("http://") || url.starts_with("https://")) {
                return Err("OXIGRAPH_QUERY_URL must use HTTP or HTTPS".to_string());
            }
            let request = Request::builder()
                .method(Method::Post)
                .uri(url)
                .header("accept", "application/sparql-results+json")
                .header("content-type", "application/sparql-query")
                .body(personal_knowledge_core::JOURNAL_QUERY.as_bytes().to_vec())
                .build();
            let response: Response = send(request).await.map_err(|error| error.to_string())?;
            if response.body().len() > MAX_JOURNAL_RESPONSE_BYTES {
                return Err("journal response is too large".to_string());
            }
            if !(200..300).contains(response.status()) {
                return Err(format!(
                    "Oxigraph rejected the journal query with {}",
                    response.status()
                ));
            }
            let payload = std::str::from_utf8(response.body())
                .map_err(|_| "Oxigraph returned non-UTF-8 data".to_string())?;
            let entries = personal_knowledge_core::decode_journal(payload)?;
            Ok(entries
                .into_iter()
                .map(|entry| types::JournalEntry {
                    id: entry.id,
                    text: entry.text,
                    kind: entry.kind,
                    created_at: entry.created_at,
                    source_id: entry.source_id,
                    source_label: entry.source_label,
                    transcript: entry.transcript,
                    topics: entry.topics,
                })
                .collect())
        })
    }
}

export!(GatewayHttp);
