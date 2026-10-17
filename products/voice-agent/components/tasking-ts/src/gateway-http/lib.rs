use serde_json::{Map, Value};
use spin_sdk::http::{send, Method as HttpMethod, Request, Response};

wit_bindgen::generate!({
    generate_all,
    path: "wit",
    world: "gateway-http",
});

const MAX_RESPONSE_BYTES: usize = 64_000;

struct GatewayHttp;

fn required(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

fn gateway_url(path: &str, identity: Option<&str>) -> Result<String, String> {
    if !path.starts_with('/') || path.starts_with("//") {
        return Err("gateway request path must be absolute and host-relative".to_string());
    }
    let base = required("TASK_GATEWAY_BASE_URL")?;
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("TASK_GATEWAY_BASE_URL must use HTTP or HTTPS".to_string());
    }
    let mut url = format!("{}{}", base.trim_end_matches('/'), path);
    if let Some(value) = identity {
        let separator = if url.contains('?') { '&' } else { '?' };
        url.push(separator);
        url.push_str("identity=");
        url.push_str(&urlencoding::encode(value));
    }
    Ok(url)
}

fn identity_body(body: Option<String>, identity: &str) -> Result<Vec<u8>, String> {
    let mut payload = match body {
        Some(value) => serde_json::from_str::<Value>(&value)
            .map_err(|_| "tasking core supplied invalid JSON".to_string())?,
        None => Value::Object(Map::new()),
    };
    let object = payload
        .as_object_mut()
        .ok_or_else(|| "tasking core supplied an invalid request body".to_string())?;
    object.insert("identity".to_string(), Value::String(identity.to_string()));
    serde_json::to_vec(&payload).map_err(|error| error.to_string())
}

fn error_detail(body: &[u8]) -> String {
    serde_json::from_slice::<Value>(body)
        .ok()
        .and_then(|payload| payload.get("detail").map(Value::to_string))
        .unwrap_or_else(|| "request failed".to_string())
        .trim_matches('"')
        .to_string()
}

impl Guest for GatewayHttp {
    fn request(method: Method, path: String, body: Option<String>) -> Result<String, String> {
        spin_executor::run(async move {
            let identity = required("TASK_IDENTITY")?;
            let token = required("TASK_GATEWAY_TOKEN")?;
            let (http_method, url, encoded_body) = match method {
                Method::Get => (HttpMethod::Get, gateway_url(&path, Some(&identity))?, None),
                Method::Post => (
                    HttpMethod::Post,
                    gateway_url(&path, None)?,
                    Some(identity_body(body, &identity)?),
                ),
            };
            let mut request = Request::builder();
            request
                .method(http_method)
                .uri(&url)
                .header("authorization", format!("Bearer {token}"));
            if encoded_body.is_some() {
                request.header("content-type", "application/json");
            }
            let request = request.body(encoded_body.unwrap_or_default()).build();
            let response: Response = send(request).await.map_err(|error| error.to_string())?;
            if response.body().len() > MAX_RESPONSE_BYTES {
                return Err("agent gateway response is too large".to_string());
            }
            if !(200..300).contains(response.status()) {
                return Err(format!(
                    "agent gateway rejected the request: {}",
                    error_detail(response.body())
                ));
            }
            String::from_utf8(response.body().to_vec())
                .map_err(|_| "agent gateway returned non-UTF-8 data".to_string())
        })
    }
}

export!(GatewayHttp);
