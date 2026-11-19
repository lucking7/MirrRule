#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable, NamedTuple
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

import cloudscraper
import requests


DEFAULT_PORT = 13193
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 10
READ_TIMEOUT_SECONDS = 30
READ_CHUNK_BYTES = 64 * 1024

BrowserFactory = Callable[[], requests.Session]
BodyValidator = Callable[[bytes], bool]

DOMAIN_PATTERN = re.compile(
    r"^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+"
    r"[a-z](?:[a-z\d-]{0,61}[a-z\d])?$",
    re.IGNORECASE,
)
CANONICAL_RULE_PATTERN = re.compile(r"^[A-Z][A-Z\d-]*,\s*\S+", re.IGNORECASE)
GEOSITE_PREFIXES = ("+.", "full:", "domain:", "keyword:")
RESOURCE_RULE = "rule"
RESOURCE_PLUGIN_CATALOG = "plugin-catalog"
RESOURCE_PLUGIN = "plugin"
RESOURCE_SCRIPT = "script"
RESOURCE_JQ = "jq"
ROUTE_DIRECT = "direct"
ROUTE_CONFIGURED_FORWARDER = "configured_forwarder"
MEDIA_TYPE_PATTERN = re.compile(
    r"^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$",
)
PLUGIN_SECTION_PATTERN = re.compile(
    r"^[ \t]*\[(?:argument|general|rewrite|script|mitm|rule)\][ \t]*\r?$",
    re.IGNORECASE | re.MULTILINE,
)
PLUGIN_NAME_PATTERN = re.compile(
    r"^#!name\s*=\s*\S.*?\r?$",
    re.IGNORECASE | re.MULTILINE,
)


def create_browser_session() -> requests.Session:
    return cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False},
        interpreter="nodejs",
        delay=10,
    )


def classify_resource_url(hostname: str, path: str) -> str:
    if hostname == "hub.kelee.one" and path == "/list.json":
        return RESOURCE_PLUGIN_CATALOG
    if path.lower().endswith(".lsr"):
        return RESOURCE_RULE
    if path.lower().endswith((".plugin", ".lpx")):
        return RESOURCE_PLUGIN
    if path.lower().endswith(".js"):
        return RESOURCE_SCRIPT
    if path.startswith("/Resource/JQLang/") and path.lower().endswith(".jq"):
        return RESOURCE_JQ
    raise ValueError("target resource type is not allowed")


def canonicalize_rule_url(raw_url: str) -> str:
    if not raw_url or any(ord(character) < 32 for character in raw_url):
        raise ValueError("invalid target URL")

    parsed = urlsplit(raw_url)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise ValueError("target must use https")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("target userinfo is not allowed")
    if parsed.fragment:
        raise ValueError("target fragments are not allowed")

    try:
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise ValueError("invalid target authority") from error

    if hostname is None:
        raise ValueError("target hostname is required")
    hostname = hostname.lower()
    if hostname != "kelee.one" and not hostname.endswith(".kelee.one"):
        raise ValueError("target hostname is not allowed")
    if port not in (None, 443):
        raise ValueError("target port is not allowed")
    resource_type = classify_resource_url(hostname, parsed.path)
    if resource_type == RESOURCE_PLUGIN_CATALOG and parsed.query:
        raise ValueError("plugin catalog query parameters are not allowed")

    return urlunsplit(("https", hostname, parsed.path, parsed.query, ""))


def normalize_upstream_base(upstream_base: str) -> str:
    parsed = urlsplit(upstream_base)
    if parsed.scheme.lower() != "https" or not parsed.netloc:
        raise ValueError("upstream base must use https")
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise ValueError("invalid upstream base")

    query = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=32)
    if sum(key == "url" for key, _ in query) > 1:
        raise ValueError("upstream base contains repeated url parameters")
    return urlunsplit(("https", parsed.netloc, parsed.path or "/", parsed.query, ""))


def build_upstream_url(upstream_base: str, target_url: str) -> str:
    parsed = urlsplit(upstream_base)
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=32)
        if key != "url"
    ]
    query.append(("url", target_url))
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(query), ""))


def is_rule_text(body: bytes) -> bool:
    if not body:
        return False
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return False

    stripped = text.lstrip("\ufeff \t\r\n")
    if not stripped:
        return False

    prefix = stripped[:2048].lower()
    if any(marker in prefix for marker in ("<!doctype html", "<html", "<body", "<script")):
        return False

    if stripped[0] in "[{":
        try:
            json.loads(stripped)
        except json.JSONDecodeError:
            pass
        else:
            return False

    for line in text.splitlines():
        candidate = line.strip().lstrip("\ufeff")
        if not candidate or candidate.startswith(("#", "!", "//", ";")):
            continue
        if CANONICAL_RULE_PATTERN.match(candidate):
            return True
        if candidate.startswith(GEOSITE_PREFIXES):
            return True
        if DOMAIN_PATTERN.match(candidate):
            return True
        try:
            if "/" in candidate:
                ipaddress.ip_network(candidate, strict=False)
                return True
        except ValueError:
            pass
    return False


def iter_nested_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from iter_nested_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from iter_nested_strings(item)


def is_plugin_catalog(body: bytes) -> bool:
    if not body:
        return False
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return False

    pending = list(iter_nested_strings(payload))
    visited: set[str] = set()
    while pending:
        candidate = pending.pop().strip()
        if not candidate or candidate in visited:
            continue
        visited.add(candidate)
        try:
            parsed = urlsplit(candidate)
            if (
                parsed.scheme.lower() == "https"
                and parsed.hostname
                and parsed.username is None
                and parsed.password is None
                and parsed.path.lower().endswith((".plugin", ".lpx"))
            ):
                return True
            if parsed.scheme.lower() == "loon":
                pending.extend(value for _, value in parse_qsl(parsed.query))
                pending.extend(unquote(part) for part in parsed.path.split("/"))
        except ValueError:
            continue
    return False


def is_plugin_text(body: bytes) -> bool:
    if not body:
        return False
    try:
        text = body.decode("utf-8").lstrip("\ufeff")
    except UnicodeDecodeError:
        return False
    if not text.strip():
        return False
    prefix = text.lstrip()[:2048].lower()
    if any(marker in prefix for marker in ("<!doctype html", "<html", "<body", "<script")):
        return False
    return bool(PLUGIN_NAME_PATTERN.search(text) and PLUGIN_SECTION_PATTERN.search(text))


def is_script_text(body: bytes) -> bool:
    if not body:
        return False
    try:
        text = body.decode("utf-8").lstrip("\ufeff")
    except UnicodeDecodeError:
        return False
    if not text.strip():
        return False

    prefix = text.lstrip()[:8192].lower()
    return not re.match(
        r"^(?:<!doctype\s+html\b|<(?:html|head|body|script)\b|"
        r"just a moment\b|attention required\b|enable javascript and cookies to continue\b|"
        r"window\.location\s*=\s*['\"][^'\"]*/cdn-cgi/challenge-platform/)",
        prefix,
    )


class FetchObservation(NamedTuple):
    route: str
    responder_status: int | None
    validation: str
    media_type: str
    body_bytes: int | None = None
    body_sha256: str | None = None


def extract_media_type(headers: object) -> str:
    raw = None
    if hasattr(headers, "get"):
        raw = headers.get("Content-Type")
    if raw is None and hasattr(headers, "items"):
        for key, value in headers.items():
            if isinstance(key, str) and key.lower() == "content-type":
                raw = value
                break
    if not isinstance(raw, str):
        return "none"
    candidate = raw.split(";", 1)[0].strip().lower()
    if not candidate:
        return "none"
    if not MEDIA_TYPE_PATTERN.match(candidate):
        return "invalid"
    return candidate


def read_limited_response_with_reason(response: requests.Response) -> tuple[bytes | None, str]:
    content_length = response.headers.get("Content-Length")
    if content_length:
        try:
            if int(content_length) > MAX_RESPONSE_BYTES:
                return None, "body_too_large"
        except ValueError:
            pass

    body = bytearray()
    for chunk in response.iter_content(chunk_size=READ_CHUNK_BYTES):
        if not chunk:
            continue
        if not isinstance(chunk, bytes):
            return None, "invalid_stream"
        body.extend(chunk)
        if len(body) > MAX_RESPONSE_BYTES:
            return None, "body_too_large"
    return bytes(body), "ok"


def read_limited_response(response: requests.Response) -> bytes | None:
    body, _ = read_limited_response_with_reason(response)
    return body


def fetch_resource_with_observation(
    request_url: str,
    browser_factory: BrowserFactory,
    validator: BodyValidator,
    invalid_message: bytes,
    *,
    route: str,
) -> tuple[int, bytes, FetchObservation]:
    session = response = None
    media_type = "none"
    responder_status = None

    def observation(validation: str, body: bytes | None = None) -> FetchObservation:
        return FetchObservation(
            route, responder_status, validation, media_type,
            len(body) if body is not None else None,
            hashlib.sha256(body).hexdigest() if body is not None else None,
        )

    try:
        session = browser_factory()
        response = session.get(
            request_url,
            timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
            stream=True,
            allow_redirects=False,
        )
        responder_status = response.status_code
        media_type = extract_media_type(response.headers)
        if responder_status != 200:
            return 502, b"upstream request failed\n", observation("skipped_non_200")
        body, reason = read_limited_response_with_reason(response)
        if body is None:
            return 502, invalid_message, observation(reason)
        if not validator(body):
            return 502, invalid_message, observation("invalid_body", body)
        return 200, body, observation("valid", body)
    except requests.exceptions.Timeout:
        return 504, b"upstream request timed out\n", observation("timeout")
    except Exception:
        return 502, b"upstream request failed\n", observation("request_error")
    finally:
        if response is not None:
            response.close()
        if session is not None:
            session.close()


def public_source_url(target_url: str) -> str:
    parsed = urlsplit(target_url)
    return urlunsplit((parsed.scheme, parsed.hostname or "", parsed.path, "", ""))


def format_fetch_log(target_url: str, status: int, observation: FetchObservation) -> str:
    immediate = observation.responder_status if observation.responder_status is not None else "none"
    origin = immediate if observation.route == ROUTE_DIRECT else "unobserved"
    fields = [
        f"source={public_source_url(target_url)}", f"status={status}", f"route={observation.route}",
        f"responder_status={immediate}", f"origin_status={origin}", f"validation={observation.validation}",
        f"media_type={observation.media_type}",
    ]
    if observation.body_bytes is not None:
        fields.extend((f"body_bytes={observation.body_bytes}", f"body_sha256={observation.body_sha256}"))
    return " ".join(fields)


def create_server(
    upstream_base: str,
    port: int = DEFAULT_PORT,
    browser_factory: BrowserFactory = create_browser_session,
    logger: logging.Logger | None = None,
) -> ThreadingHTTPServer:
    normalized_upstream = normalize_upstream_base(upstream_base)
    gateway_logger = logger or logging.getLogger("browser-rule-gateway")

    text_type = "text/plain; charset=utf-8"
    script = (is_script_text, b"upstream response is not valid JavaScript\n")
    resource_formats = {
        RESOURCE_RULE: (is_rule_text, b"upstream response is not a valid rule file\n", text_type),
        RESOURCE_PLUGIN: (is_plugin_text, b"upstream response is not a valid plugin file\n", text_type),
        RESOURCE_PLUGIN_CATALOG: (is_plugin_catalog, b"upstream response is not a valid plugin catalog\n",
                                  "application/json; charset=utf-8"),
        RESOURCE_SCRIPT: (*script, "application/javascript; charset=utf-8"),
        RESOURCE_JQ: (*script, text_type),
    }

    class GatewayHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format_string, *args):
            return

        def send_body(
            self,
            status: int,
            body: bytes,
            *,
            head_only: bool,
            content_type: str = "text/plain; charset=utf-8",
            extra_headers: dict[str, str] | None = None,
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            for key, value in (extra_headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.close_connection = True
            if not head_only:
                self.wfile.write(body)

        def handle_request(self, *, head_only: bool) -> None:
            parsed_request = urlsplit(self.path)
            if parsed_request.path == "/health" and not parsed_request.query:
                self.send_body(
                    200,
                    b"ready\n",
                    head_only=head_only,
                    extra_headers={"X-Gateway-Health": "startup-only"},
                )
                return
            if parsed_request.path != "/":
                self.send_body(404, b"not found\n", head_only=head_only)
                return

            try:
                query = parse_qsl(
                    parsed_request.query,
                    keep_blank_values=True,
                    max_num_fields=4,
                )
            except ValueError:
                query = []
            if len(query) != 1 or query[0][0] != "url":
                self.send_body(400, b"exactly one url parameter is required\n", head_only=head_only)
                return

            try:
                target_url = canonicalize_rule_url(query[0][1])
            except ValueError:
                self.send_body(400, b"invalid resource URL\n", head_only=head_only)
                return

            resource_type = classify_resource_url(
                urlsplit(target_url).hostname or "",
                urlsplit(target_url).path,
            )
            validator, invalid_message, content_type = resource_formats[resource_type]
            direct = resource_type == RESOURCE_PLUGIN_CATALOG
            status, body, observation = fetch_resource_with_observation(
                target_url if direct else build_upstream_url(normalized_upstream, target_url),
                browser_factory, validator, invalid_message,
                route=ROUTE_DIRECT if direct else ROUTE_CONFIGURED_FORWARDER,
            )
            gateway_logger.info("%s", format_fetch_log(target_url, status, observation))
            self.send_body(
                status,
                body,
                head_only=head_only,
                content_type=content_type,
            )

        def do_GET(self) -> None:
            self.handle_request(head_only=False)

        def do_HEAD(self) -> None:
            self.handle_request(head_only=True)

        def method_not_allowed(self) -> None:
            self.send_body(
                405,
                b"method not allowed\n",
                head_only=False,
                extra_headers={"Allow": "GET, HEAD"},
            )

        do_POST = method_not_allowed
        do_PUT = method_not_allowed
        do_PATCH = method_not_allowed
        do_DELETE = method_not_allowed
        do_CONNECT = method_not_allowed
        do_OPTIONS = method_not_allowed
        do_TRACE = method_not_allowed

    server = ThreadingHTTPServer(("127.0.0.1", port), GatewayHandler)
    server.daemon_threads = True
    return server


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Loopback browser-backed Kelee resource gateway")
    parser.add_argument(
        "--upstream-base",
        default=os.environ.get("BROWSER_RULE_UPSTREAM_BASE") or os.environ.get("PROXY_BASE"),
        help="Existing private Worker PROXY_BASE URL",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("BROWSER_RULE_GATEWAY_PORT", DEFAULT_PORT)),
    )
    args = parser.parse_args(argv)
    if not args.upstream_base:
        parser.error(
            "--upstream-base or BROWSER_RULE_UPSTREAM_BASE/PROXY_BASE is required"
        )
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        server = create_server(args.upstream_base, port=args.port)
    except ValueError as error:
        raise SystemExit(str(error)) from error

    actual_port = server.server_port
    print(
        f"BROWSER_RULE_GATEWAY_READY host=127.0.0.1 port={actual_port}",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
