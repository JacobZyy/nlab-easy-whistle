use reqwest::{Client, Method, header::HeaderValue, redirect::Policy};
use serde::Serialize;
use serde_json::{Value, json};
use std::{fs, io::ErrorKind, path::PathBuf, time::Duration};
use url::{Url, form_urlencoded};

const RULE_NAME: &str = "NLab Easy Whistle";
const BODY_LIMIT: usize = 1024 * 1024;
const CONNECTION_ERROR: &str = "连接 Whistle 失败或超时；请检查本地地址。";

#[derive(Debug, Serialize)]
pub struct BridgeResponse {
    pub status: u16,
    pub body: Value,
}

fn failure(status: u16, message: &str) -> BridgeResponse {
    BridgeResponse {
        status,
        body: json!({ "error": message }),
    }
}

fn local_url(value: &str) -> Result<Url, BridgeResponse> {
    let url = Url::parse(value).map_err(|_| failure(400, "Whistle 地址格式不正确。"))?;
    if url.scheme() != "http"
        || !matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(failure(
            400,
            "Whistle 地址必须是无凭据、查询或片段的本地 HTTP 地址。",
        ));
    }
    Ok(url)
}

fn prepare(target: &str, path: &str, body: Option<&str>) -> Result<(Url, Method), BridgeResponse> {
    let (endpoint, query) = path.split_once('?').unwrap_or((path, ""));
    let method = match endpoint {
        "rules/status" | "rules/value" => Method::GET,
        "rules/add" => Method::POST,
        _ => return Err(failure(404, "接口不存在。")),
    };
    let parameters: Vec<_> = form_urlencoded::parse(query.as_bytes()).collect();
    if (endpoint == "rules/value"
        && (parameters.len() != 1 || parameters[0].0 != "name" || parameters[0].1 != RULE_NAME))
        || (endpoint != "rules/value" && !parameters.is_empty())
    {
        return Err(failure(
            400,
            "只允许 NLab Easy Whistle 规则文件及规定参数。",
        ));
    }
    if method == Method::POST {
        let body = body.ok_or_else(|| failure(400, "规则保存缺少表单。"))?;
        if body.len() > BODY_LIMIT {
            return Err(failure(413, "规则文本超过 1 MiB。"));
        }
        let fields: Vec<_> = form_urlencoded::parse(body.as_bytes()).collect();
        let mut keys: Vec<_> = fields.iter().map(|(key, _)| key.as_ref()).collect();
        keys.sort_unstable();
        if keys != ["name", "selected", "value"]
            || !fields
                .iter()
                .any(|(key, value)| key == "name" && value == RULE_NAME)
            || !fields
                .iter()
                .any(|(key, value)| key == "selected" && value == "1")
        {
            return Err(failure(
                400,
                "只允许保存并启用 NLab Easy Whistle 规则文件。",
            ));
        }
    } else if body.is_some() {
        return Err(failure(400, "读取规则不允许表单。"));
    }
    let target = local_url(target)?;
    let base = target.as_str().strip_suffix('/').unwrap_or(target.as_str());
    let mut upstream = Url::parse(&format!("{base}/cgi-bin/{endpoint}"))
        .map_err(|_| failure(400, "Whistle 地址格式不正确。"))?;
    if endpoint == "rules/value" {
        upstream.query_pairs_mut().append_pair("name", RULE_NAME);
    }
    Ok((upstream, method))
}

fn read_auth(target: &Url, pid_path: &PathBuf) -> Result<Option<HeaderValue>, BridgeResponse> {
    let text = match fs::read_to_string(pid_path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(_) => {
            return Err(failure(
                502,
                "无法读取 Whistle.app 本地凭据文件；请求未发送。",
            ));
        }
    };
    let fields: Vec<_> = text.split(',').collect();
    let invalid = || failure(502, "Whistle.app 本地凭据文件格式异常；请求未发送。");
    if fields.len() != 4 {
        return Err(invalid());
    }
    let positive_digits = |value: &str| {
        !value.starts_with('0') && !value.is_empty() && value.bytes().all(|c| c.is_ascii_digit())
    };
    if !positive_digits(fields[0])
        || !positive_digits(fields[2])
        || fields[3].is_empty()
        || fields[3]
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\u{feff}')
    {
        return Err(invalid());
    }
    let pid = fields[0].parse::<i32>().map_err(|_| invalid())?;
    let port = fields[2].parse::<u16>().map_err(|_| invalid())?;
    if port == 0 {
        return Err(invalid());
    }
    let auth = HeaderValue::from_str(fields[3]).map_err(|_| invalid())?;
    let host = if fields[1].is_empty() {
        "127.0.0.1"
    } else {
        fields[1]
    };
    let client = local_url(&format!("http://{host}:{port}"))
        .map_err(|_| failure(502, "Whistle.app 本地凭据地址异常；请求未发送。"))?;
    if client.path() != "/" {
        return Err(failure(502, "Whistle.app 本地凭据地址异常；请求未发送。"));
    }
    if client.host_str() != target.host_str()
        || client.port() != target.port()
        || !process_alive(pid)
    {
        return Ok(None);
    }
    Ok(Some(auth))
}

#[cfg(unix)]
fn process_alive(pid: i32) -> bool {
    // Signal 0 only checks process existence; it does not send a signal.
    unsafe { libc::kill(pid, 0) == 0 }
}

#[cfg(not(unix))]
fn process_alive(_pid: i32) -> bool {
    // shortcut: Whistle.app authentication requires Unix PID checks; add native checks for other OSes.
    false
}

pub async fn request(
    target: String,
    path: String,
    body: Option<String>,
    pid_path: PathBuf,
) -> BridgeResponse {
    let (upstream, method) = match prepare(&target, &path, body.as_deref()) {
        Ok(prepared) => prepared,
        Err(error) => return error,
    };
    let auth = match read_auth(&upstream, &pid_path) {
        Ok(auth) => auth,
        Err(error) => return error,
    };
    let client = match Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(10))
        .resolve_to_addrs(
            "localhost",
            &["127.0.0.1:0".parse().unwrap(), "[::1]:0".parse().unwrap()],
        )
        .build()
    {
        Ok(client) => client,
        Err(_) => return failure(502, CONNECTION_ERROR),
    };
    let mut request = client.request(method, upstream);
    if let Some(auth) = auth {
        request = request.header("x-whistle-special-auth", auth);
    }
    if let Some(body) = body {
        request = request
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(body);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => return failure(502, CONNECTION_ERROR),
    };
    if response.status().is_redirection() {
        return failure(502, CONNECTION_ERROR);
    }
    if !response.status().is_success() {
        return failure(
            response.status().as_u16(),
            &format!("Whistle 返回 HTTP {}。", response.status().as_u16()),
        );
    }
    match response.json::<Value>().await {
        Ok(body) => BridgeResponse { status: 200, body },
        Err(error) if error.is_timeout() || error.is_body() => failure(502, CONNECTION_ERROR),
        Err(_) => failure(502, "Whistle 返回的内容不是有效 JSON。"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Read, Write},
        net::TcpListener,
        sync::atomic::{AtomicUsize, Ordering},
        thread::{self, JoinHandle},
        time::Instant,
    };

    static NEXT_FILE: AtomicUsize = AtomicUsize::new(0);

    fn pid_path() -> PathBuf {
        std::env::temp_dir().join(format!(
            "nlab-whistle-{}-{}.pid",
            std::process::id(),
            NEXT_FILE.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn form() -> String {
        form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("name", RULE_NAME),
                ("value", "example.com host://127.0.0.1"),
                ("selected", "1"),
            ])
            .finish()
    }

    fn mock_server(
        responses: Vec<(u16, &'static str, &'static str)>,
    ) -> (String, JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let task = thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, headers, body) in responses {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error)
                            if error.kind() == ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(error) => panic!("mock HTTP accept: {error}"),
                    }
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                loop {
                    let mut line = String::new();
                    assert!(reader.read_line(&mut line).unwrap() > 0);
                    request.push_str(&line);
                    if line == "\r\n" {
                        break;
                    }
                }
                let length: usize = request
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse().unwrap())
                    })
                    .unwrap_or(0);
                let mut content = vec![0; length];
                reader.read_exact(&mut content).unwrap();
                request.push_str(&String::from_utf8(content).unwrap());
                requests.push(request);
                write!(stream, "HTTP/1.1 {status} Mock\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}", body.len()).unwrap();
            }
            requests
        });
        (address, task)
    }

    #[test]
    fn rejects_untrusted_targets_paths_and_forms() {
        for target in [
            "http://example.com",
            "http://127.0.0.1.evil",
            "https://127.0.0.1",
            "http://user:secret@127.0.0.1",
            "http://127.0.0.1?x=1",
            "http://127.0.0.1#x",
        ] {
            assert_eq!(
                prepare(target, "rules/status", None).unwrap_err().status,
                400
            );
        }
        let target = "http://127.0.0.1:18899";
        assert_eq!(
            prepare(target, "rules/remove", None).unwrap_err().status,
            404
        );
        for path in [
            "rules/status?extra=1",
            "rules/value?name=Default",
            "rules/value?name=NLab+Easy+Whistle&name=NLab+Easy+Whistle",
        ] {
            assert_eq!(prepare(target, path, None).unwrap_err().status, 400);
        }
        for body in [
            form().replace("selected=1", "selected=0"),
            form().replace("NLab+Easy+Whistle", "Default"),
            format!("{}&name=NLab+Easy+Whistle", form()),
            format!("{}&extra=1", form()),
        ] {
            assert_eq!(
                prepare(target, "rules/add", Some(&body))
                    .unwrap_err()
                    .status,
                400
            );
        }
        assert_eq!(
            prepare(target, "rules/add", Some(&"x".repeat(BODY_LIMIT + 1)))
                .unwrap_err()
                .status,
            413
        );
        assert_eq!(
            prepare(target, "rules/status", Some(""))
                .unwrap_err()
                .status,
            400
        );
        assert_eq!(
            prepare("http://[::1]:18899/whistle", "rules/status", None)
                .unwrap()
                .0
                .as_str(),
            "http://[::1]:18899/whistle/cgi-bin/rules/status"
        );
    }

    #[test]
    fn credentials_require_matching_live_process_and_fail_closed_when_invalid() {
        let path = pid_path();
        let target = local_url("http://127.0.0.1:18899").unwrap();
        assert!(read_auth(&target, &path).unwrap().is_none());
        fs::write(
            &path,
            format!("{},127.0.0.1,18899,test-local-secret", std::process::id()),
        )
        .unwrap();
        assert_eq!(
            read_auth(&target, &path).unwrap().unwrap(),
            "test-local-secret"
        );
        for other in ["http://localhost:18899", "http://127.0.0.1:18898"] {
            assert!(
                read_auth(&local_url(other).unwrap(), &path)
                    .unwrap()
                    .is_none()
            );
        }
        fs::write(&path, "2147483647,127.0.0.1,18899,test-local-secret").unwrap();
        assert!(read_auth(&target, &path).unwrap().is_none());
        for content in [
            "broken",
            "1,127.0.0.1,18899,",
            "1,127.0.0.1,70000,secret",
            "1,evil.example,18899,secret",
            "1,127.0.0.1/path,18899,secret",
            "1,127.0.0.1,18899,secret\r\n",
        ] {
            fs::write(&path, content).unwrap();
            assert_eq!(read_auth(&target, &path).unwrap_err().status, 502);
        }
        fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn forwards_only_three_rule_endpoints_and_keeps_credentials_native() {
        let (target, server) = mock_server(vec![
            (
                200,
                "x-whistle-special-auth: response-secret\r\nSet-Cookie: private\r\n",
                "{\"ec\":0}"
            );
            3
        ]);
        let path = pid_path();
        fs::write(
            &path,
            format!(
                "{},127.0.0.1,{},test-local-secret",
                std::process::id(),
                local_url(&target).unwrap().port().unwrap()
            ),
        )
        .unwrap();
        for (endpoint, body) in [
            ("rules/status", None),
            ("rules/value?name=NLab+Easy+Whistle", None),
            ("rules/add", Some(form())),
        ] {
            let result = request(target.clone(), endpoint.into(), body, path.clone()).await;
            assert_eq!(result.status, 200);
            assert_eq!(result.body, json!({ "ec": 0 }));
            assert!(!serde_json::to_string(&result).unwrap().contains("secret"));
        }
        let requests = server.join().unwrap();
        assert!(requests[0].starts_with("GET /cgi-bin/rules/status HTTP/1.1\r\n"));
        assert!(
            requests[1].starts_with("GET /cgi-bin/rules/value?name=NLab+Easy+Whistle HTTP/1.1\r\n")
        );
        assert!(requests[2].starts_with("POST /cgi-bin/rules/add HTTP/1.1\r\n"));
        assert!(requests[2].ends_with(&form()));
        assert!(
            requests
                .iter()
                .all(|request| request.contains("x-whistle-special-auth: test-local-secret\r\n"))
        );
        fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn exposes_http_and_json_errors_without_following_redirects() {
        let (target, server) = mock_server(vec![
            (401, "", "login"),
            (200, "", "<html>wrong</html>"),
            (302, "Location: http://example.com/\r\n", ""),
        ]);
        let path = pid_path();
        for (status, detail) in [
            (401, "HTTP 401"),
            (502, "有效 JSON"),
            (502, "连接 Whistle 失败"),
        ] {
            let result = request(target.clone(), "rules/status".into(), None, path.clone()).await;
            assert_eq!(result.status, status);
            assert!(result.body["error"].as_str().unwrap().contains(detail));
        }
        assert_eq!(server.join().unwrap().len(), 3);
        assert_eq!(
            request(target, "rules/status".into(), None, path)
                .await
                .status,
            502
        );
    }
}
