use std::borrow::Cow;
use std::sync::Arc;

use tauri::http::header::{ACCESS_CONTROL_ALLOW_ORIGIN, CACHE_CONTROL, CONTENT_TYPE};
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::pipeline::AppState;
use crate::types::ProxyLevel;

const TEXT_PLAIN: &str = "text/plain; charset=utf-8";
const OCTET_STREAM: &str = "application/octet-stream";
const IMAGE_JPEG: &str = "image/jpeg";

#[derive(Debug, PartialEq, Eq)]
enum RouteKind {
    Ping,
    Pixels(String, ProxyLevel),
    NotFound,
}

pub fn handle<R: Runtime>(context: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = context.app_handle().clone();
    let path = request.uri().path().trim_start_matches('/').to_owned();
    tracing::debug!(%path, "aether request");
    tauri::async_runtime::spawn(async move {
        responder.respond(serve(&app, &path));
    });
}

fn parse_pixels_path(path: &str) -> Option<(String, ProxyLevel)> {
    let mut parts = path.split('/');
    if parts.next()? != "pixels" {
        return None;
    }
    let image_id = parts.next()?;
    let level = parts.next()?;
    if image_id.is_empty() || parts.next().is_some() {
        return None;
    }
    let level = match level {
        "l0" => ProxyLevel::L0,
        "l1" => ProxyLevel::L1,
        "l2" => ProxyLevel::L2,
        _ => return None,
    };
    Some((image_id.to_owned(), level))
}

fn classify(path: &str) -> RouteKind {
    match path.split('/').next().unwrap_or_default() {
        "ping" => RouteKind::Ping,
        "pixels" => match parse_pixels_path(path) {
            Some((image_id, level)) => RouteKind::Pixels(image_id, level),
            None => RouteKind::NotFound,
        },
        _ => RouteKind::NotFound,
    }
}

fn serve<R: Runtime>(app: &AppHandle<R>, path: &str) -> Response<Cow<'static, [u8]>> {
    match classify(path) {
        RouteKind::Ping => ping_response(),
        RouteKind::Pixels(image_id, level) => serve_pixels(app, &image_id, level),
        RouteKind::NotFound => not_found(),
    }
}

fn serve_pixels<R: Runtime>(app: &AppHandle<R>, image_id: &str, level: ProxyLevel) -> Response<Cow<'static, [u8]>> {
    let state = app.state::<AppState>();
    if let Some(body) = state.services.store.get(image_id, level) {
        return pixels_response(level, &body);
    }
    if let Some(path) = state.services.registry.resolve(image_id) {
        if let Some(body) = state.services.cache.load_body(&path, level) {
            let body = Arc::new(body);
            state.services.store.insert(image_id.to_owned(), level, Arc::clone(&body));
            return pixels_response(level, &body);
        }
    }
    not_found()
}

fn pixels_response(level: ProxyLevel, body: &Arc<Vec<u8>>) -> Response<Cow<'static, [u8]>> {
    let content_type = match level {
        ProxyLevel::L0 => IMAGE_JPEG,
        ProxyLevel::L1 | ProxyLevel::L2 => OCTET_STREAM,
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(CACHE_CONTROL, "no-cache")
        .body(Cow::Owned(body.as_ref().clone()))
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"".as_slice())))
}

fn ping_response() -> Response<Cow<'static, [u8]>> {
    respond_text(StatusCode::OK, Cow::Borrowed(b"pong".as_slice()))
}

fn not_found() -> Response<Cow<'static, [u8]>> {
    respond_text(StatusCode::NOT_FOUND, Cow::Borrowed(b"not found".as_slice()))
}

fn respond_text(status: StatusCode, body: Cow<'static, [u8]>) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, TEXT_PLAIN)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .unwrap_or_else(|_| Response::new(Cow::Borrowed(b"".as_slice())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_responds_pong_with_cors() {
        let response = ping_response();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_ref(), b"pong");
        assert_eq!(
            response.headers().get(ACCESS_CONTROL_ALLOW_ORIGIN).and_then(|value| value.to_str().ok()),
            Some("*"),
        );
    }

    #[test]
    fn classify_ping_and_unknown() {
        assert_eq!(classify("ping"), RouteKind::Ping);
        assert_eq!(classify("nope"), RouteKind::NotFound);
        assert_eq!(classify("thumb/1"), RouteKind::NotFound);
    }

    #[test]
    fn classify_pixels_paths() {
        assert_eq!(classify("pixels/abc/l0"), RouteKind::Pixels("abc".to_owned(), ProxyLevel::L0));
        assert_eq!(classify("pixels/abc/l1"), RouteKind::Pixels("abc".to_owned(), ProxyLevel::L1));
        assert_eq!(classify("pixels/deadbeef/l2"), RouteKind::Pixels("deadbeef".to_owned(), ProxyLevel::L2));
    }

    #[test]
    fn classify_rejects_malformed_pixels_paths() {
        assert_eq!(classify("pixels/abc"), RouteKind::NotFound);
        assert_eq!(classify("pixels/abc/l9"), RouteKind::NotFound);
        assert_eq!(classify("pixels//l0"), RouteKind::NotFound);
        assert_eq!(classify("pixels/abc/l0/0_0"), RouteKind::NotFound);
    }

    #[test]
    fn pixels_response_sets_content_type_and_cache_headers() {
        let body = Arc::new(vec![1u8, 2, 3]);
        let l0 = pixels_response(ProxyLevel::L0, &body);
        assert_eq!(l0.headers().get(CONTENT_TYPE).and_then(|value| value.to_str().ok()), Some(IMAGE_JPEG));
        assert_eq!(l0.headers().get(CACHE_CONTROL).and_then(|value| value.to_str().ok()), Some("no-cache"));
        assert_eq!(l0.body().as_ref(), &[1u8, 2, 3]);
        let l1 = pixels_response(ProxyLevel::L1, &body);
        assert_eq!(l1.headers().get(CONTENT_TYPE).and_then(|value| value.to_str().ok()), Some(OCTET_STREAM));
    }
}
