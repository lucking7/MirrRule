import hashlib
import http.client
import importlib.util
import io
import json
import logging
from pathlib import Path
import threading
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlencode, urlsplit

import requests


MODULE_PATH = Path(__file__).parents[1] / "browser-rule-gateway.py"
SPEC = importlib.util.spec_from_file_location("browser_rule_gateway", MODULE_PATH)
assert SPEC and SPEC.loader
gateway = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gateway)


class FakeResponse:
    def __init__(self, status_code=200, body=b"DOMAIN,example.com\n", headers=None):
        self.status_code = status_code
        self.body = body
        self.headers = headers or {}
        self.closed = False

    def iter_content(self, chunk_size):
        for offset in range(0, len(self.body), chunk_size):
            yield self.body[offset : offset + chunk_size]

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self, factory):
        self.factory = factory
        self.closed = False

    def get(self, url, **kwargs):
        self.factory.calls.append((url, kwargs))
        outcome = self.factory.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        self.factory.responses.append(outcome)
        return outcome

    def close(self):
        self.closed = True
        self.factory.closed_sessions += 1


class FakeBrowserFactory:
    def __init__(self, outcomes=()):
        self.outcomes = list(outcomes)
        self.calls = []
        self.responses = []
        self.created_sessions = 0
        self.closed_sessions = 0

    def __call__(self):
        self.created_sessions += 1
        return FakeSession(self)


class GatewayHarness:
    def __init__(self, factory):
        self.log_stream = io.StringIO()
        self.logger = logging.getLogger(f"gateway-test-{id(self)}")
        self.logger.handlers.clear()
        self.logger.propagate = False
        self.logger.setLevel(logging.INFO)
        self.logger.addHandler(logging.StreamHandler(self.log_stream))
        self.server = gateway.create_server(
            upstream_base="https://worker.example/proxy?token=do-not-log&url=",
            port=0,
            browser_factory=factory,
            logger=self.logger,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        connection.request(method, path)
        response = connection.getresponse()
        body = response.read()
        headers = dict(response.getheaders())
        connection.close()
        return response.status, headers, body


def rule_path(target):
    return "/?" + urlencode({"url": target})


class BrowserRuleGatewayTest(unittest.TestCase):
    def test_plugin_catalog_is_fetched_directly_and_returned_as_json(self):
        catalog_body = json.dumps(
            {
                "plugins": [
                    {
                        "name": "Bilibili",
                        "download": "https://kelee.one/Tool/Loon/Plugin/Bilibili.plugin",
                    },
                    {
                        "nested": {
                            "url": "https://kelee.one/Tool/Loon/Plugin/YouTube.lpx"
                        }
                    },
                ]
            }
        ).encode()
        response = FakeResponse(body=catalog_body)
        factory = FakeBrowserFactory([response])

        with GatewayHarness(factory) as harness:
            status, headers, body = harness.request(
                "GET",
                rule_path("https://hub.kelee.one/list.json"),
            )

        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "application/json; charset=utf-8")
        self.assertEqual(body, catalog_body)
        self.assertEqual(factory.calls[0][0], "https://hub.kelee.one/list.json")
        self.assertEqual(factory.created_sessions, 1)
        self.assertEqual(factory.closed_sessions, 1)
        self.assertTrue(response.closed)

    def test_plugin_catalog_rejects_invalid_or_oversized_json(self):
        outcomes = [
            FakeResponse(body=b"not-json"),
            FakeResponse(body=b'{"plugins": []}'),
            FakeResponse(body=b'{"url": "https://kelee.one/file.txt"}'),
            FakeResponse(body=b"\xff\xfe"),
            FakeResponse(
                body=b'{}',
                headers={"Content-Length": str(gateway.MAX_RESPONSE_BYTES + 1)},
            ),
        ]
        factory = FakeBrowserFactory(outcomes)

        with GatewayHarness(factory) as harness:
            statuses = [
                harness.request(
                    "GET",
                    rule_path("https://hub.kelee.one/list.json"),
                )[0]
                for _ in outcomes
            ]

        self.assertEqual(statuses, [502, 502, 502, 502, 502])

    def test_plugin_catalog_accepts_encoded_loon_install_links(self):
        catalog_body = json.dumps({"plugins": [{"url":
            "loon://install-plugin?url=https%3A%2F%2Fkelee.one%2Ftest.lpx%3Fversion%3D2"
        }]}).encode()
        factory = FakeBrowserFactory([FakeResponse(body=catalog_body)])
        with GatewayHarness(factory) as harness:
            status, _, body = harness.request("GET", rule_path("https://hub.kelee.one/list.json"))
        self.assertEqual(status, 200)
        self.assertEqual(body, catalog_body)
        self.assertFalse(gateway.is_plugin_catalog(b'{"url":"https://[/test.lpx"}'))
        self.assertFalse(gateway.is_plugin_catalog(b'{"url":"loon://install-plugin?url=https%3A%2F%2Fu%3Ap%40kelee.one%2Ftest.lpx"}'))

    def test_plugin_resources_use_the_worker_and_require_plugin_structure(self):
        plugin_body = (
            b"#!name=Bilibili\n"
            b"[Script]\n"
            b"http-response ^https://example.com script-path=https://example.com/a.js\n"
        )
        response = FakeResponse(body=plugin_body)
        factory = FakeBrowserFactory([response])

        with GatewayHarness(factory) as harness:
            target = "https://kelee.one/Tool/Loon/Plugin/Bilibili.plugin"
            status, headers, body = harness.request("GET", rule_path(target))

        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "text/plain; charset=utf-8")
        self.assertEqual(body, plugin_body)
        query = parse_qs(urlsplit(factory.calls[0][0]).query)
        self.assertEqual(query["url"], [target])

    def test_lpx_accepts_crlf_and_head_still_validates_the_body(self):
        plugin_body = b"#!name = YouTube\r\n  [General]  \r\nforce-http-engine = example.com\r\n"
        response = FakeResponse(body=plugin_body)
        factory = FakeBrowserFactory([response])

        with GatewayHarness(factory) as harness:
            status, headers, body = harness.request(
                "HEAD",
                rule_path("https://kelee.one/Tool/Loon/Plugin/YouTube.lpx"),
            )

        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(headers["Content-Length"], str(len(plugin_body)))
        self.assertEqual(factory.calls[0][1]["allow_redirects"], False)

    def test_plugin_resources_reject_invalid_content_and_validate_head_bodies(self):
        outcomes = [
            FakeResponse(body=b"#!name=Missing section\n"),
            FakeResponse(body=b"[Script]\nvalue=1\n"),
            FakeResponse(body=b"#!name=Unknown\n[Unknown]\nvalue=1\n"),
            FakeResponse(body=b"<!doctype html><html>challenge</html>"),
            FakeResponse(body=b"\xff\xfe"),
        ]
        factory = FakeBrowserFactory(outcomes)

        with GatewayHarness(factory) as harness:
            statuses = [
                harness.request(
                    "HEAD",
                    rule_path("https://kelee.one/Tool/Loon/Plugin/Test.lpx"),
                )[0]
                for _ in outcomes
            ]

        self.assertEqual(statuses, [502, 502, 502, 502, 502])
        self.assertTrue(all(call[1]["stream"] for call in factory.calls))

    def test_script_resources_use_the_worker_and_return_utf8_javascript(self):
        script_body = "const message = '<body>你好';\n$done({ body: message });\n".encode()
        response = FakeResponse(body=script_body)
        factory = FakeBrowserFactory([response])

        with GatewayHarness(factory) as harness:
            target = "https://kelee.one/Resource/Script/Bilibili.js?token=do-not-log"
            status, headers, body = harness.request("GET", rule_path(target))
            logs = harness.log_stream.getvalue()

        self.assertEqual(status, 200)
        self.assertEqual(
            headers["Content-Type"],
            "application/javascript; charset=utf-8",
        )
        self.assertEqual(body, script_body)
        query = parse_qs(urlsplit(factory.calls[0][0]).query)
        self.assertEqual(query["url"], [target])
        self.assertIn("https://kelee.one/Resource/Script/Bilibili.js", logs)
        self.assertNotIn("do-not-log", logs)

    def test_script_resources_reject_html_challenges_empty_and_non_utf8_content(self):
        outcomes = [
            FakeResponse(body=b"<!doctype html><html>blocked</html>"),
            FakeResponse(body=b"<html>Just a moment...</html>"),
            FakeResponse(body=b"window.location='/cdn-cgi/challenge-platform/test';"),
            FakeResponse(body=b"Enable JavaScript and cookies to continue"),
            FakeResponse(body=b" \n\t"),
            FakeResponse(body=b"\xff\xfe"),
        ]
        factory = FakeBrowserFactory(outcomes)

        with GatewayHarness(factory) as harness:
            statuses = [
                harness.request(
                    "GET",
                    rule_path("https://kelee.one/Resource/Script/Test.js"),
                )[0]
                for _ in outcomes
            ]

        self.assertEqual(statuses, [502, 502, 502, 502, 502, 502])

    def test_jq_dependencies_use_validated_text_and_a_limited_path(self):
        factory = FakeBrowserFactory([
            FakeResponse(body=b'del(.data.ads)\n'),
            FakeResponse(body=b'<html>challenge</html>'),
        ])
        with GatewayHarness(factory) as harness:
            target = 'https://kelee.one/Resource/JQLang/Bilibili/test.jq'
            status, headers, body = harness.request('GET', rule_path(target))
            self.assertEqual(status, 200)
            self.assertEqual(headers['Content-Type'], 'text/plain; charset=utf-8')
            self.assertEqual(body, b'del(.data.ads)\n')
            self.assertEqual(harness.request('GET', rule_path(target))[0], 502)
            self.assertEqual(harness.request('GET', rule_path('https://kelee.one/other/test.jq'))[0], 400)
        self.assertEqual(len(factory.calls), 2)

    def test_valid_get_and_head_use_independent_browser_sessions(self):
        rule_body = b"# RuleCount: 11\nDOMAIN, cesu-hz.zjtelecom.com.cn\nDOMAIN, 4gsuzhou1.speedtest.jsinfo.net\n"
        get_response = FakeResponse(body=rule_body)
        head_response = FakeResponse(body=rule_body)
        factory = FakeBrowserFactory([get_response, head_response])

        with GatewayHarness(factory) as harness:
            target = "https://RULE.kelee.one/path/speedtest.lsr"
            get_status, get_headers, get_body = harness.request("GET", rule_path(target))
            head_status, head_headers, head_body = harness.request("HEAD", rule_path(target))

            self.assertEqual(get_status, 200)
            self.assertEqual(head_status, 200)
            self.assertEqual(get_body, rule_body)
            self.assertEqual(head_body, b"")
            self.assertEqual(get_headers["Content-Type"], "text/plain; charset=utf-8")
            self.assertEqual(head_headers["Content-Length"], str(len(rule_body)))
            self.assertEqual(factory.created_sessions, 2)
            self.assertEqual(factory.closed_sessions, 2)
            self.assertTrue(all(response.closed for response in factory.responses))

            for upstream_url, kwargs in factory.calls:
                query = parse_qs(urlsplit(upstream_url).query)
                self.assertEqual(query["token"], ["do-not-log"])
                self.assertEqual(
                    query["url"],
                    ["https://rule.kelee.one/path/speedtest.lsr"],
                )
                self.assertEqual(kwargs["timeout"], (10, 30))
                self.assertTrue(kwargs["stream"])
                self.assertFalse(kwargs["allow_redirects"])

            logs = harness.log_stream.getvalue()
            self.assertIn("https://rule.kelee.one/path/speedtest.lsr", logs)
            self.assertNotIn("worker.example", logs)
            self.assertNotIn("do-not-log", logs)

    def test_rejects_invalid_targets_without_opening_a_browser_session(self):
        factory = FakeBrowserFactory()
        invalid_paths = [
            rule_path("http://rule.kelee.one/path/test.lsr"),
            rule_path("https://example.com/path/test.lsr"),
            rule_path("https://evilkelee.one/path/test.lsr"),
            rule_path("https://user:pass@rule.kelee.one/path/test.lsr"),
            rule_path("https://rule.kelee.one/path/test.list"),
            rule_path("https://rule.kelee.one/list.json"),
            rule_path("https://hub.kelee.one/path/list.json"),
            rule_path("https://hub.kelee.one/list.json?cache=bust"),
            rule_path("https://kelee.one/path/test.css"),
            rule_path("https://rule.kelee.one:8443/path/test.lsr"),
            "/?url=https%3A%2F%2Frule.kelee.one%2Fa.lsr&url=https%3A%2F%2Frule.kelee.one%2Fb.lsr",
            "/?url=https%3A%2F%2Frule.kelee.one%2Fa.lsr&extra=1",
        ]

        with GatewayHarness(factory) as harness:
            for path in invalid_paths:
                with self.subTest(path=path):
                    status, _, _ = harness.request("GET", path)
                    self.assertEqual(status, 400)
            status, headers, _ = harness.request("POST", rule_path("https://rule.kelee.one/a.lsr"))
            self.assertEqual(status, 405)
            self.assertEqual(headers["Allow"], "GET, HEAD")

        self.assertEqual(factory.created_sessions, 0)
        self.assertEqual(factory.calls, [])

    def test_rejects_bad_upstream_responses_without_retrying(self):
        oversized = b"DOMAIN,example.com\n" + b"x" * gateway.MAX_RESPONSE_BYTES
        outcomes = [
            FakeResponse(status_code=403, body=b"forbidden"),
            FakeResponse(body=b"<!doctype html><html>challenge</html>"),
            FakeResponse(body=b'{"rules": ["example.com"]}'),
            FakeResponse(body=b"  \n"),
            FakeResponse(body=b"DOMAIN,   \n"),
            FakeResponse(body=b"\xff\xfe"),
            requests.exceptions.Timeout("timed out"),
            FakeResponse(body=oversized),
        ]
        factory = FakeBrowserFactory(outcomes)

        with GatewayHarness(factory) as harness:
            statuses = [
                harness.request("GET", rule_path("https://rule.kelee.one/test.lsr"))[0]
                for _ in outcomes
            ]

        self.assertEqual(statuses, [502, 502, 502, 502, 502, 502, 504, 502])
        self.assertEqual(len(factory.calls), len(outcomes))
        self.assertEqual(factory.created_sessions, len(outcomes))
        self.assertEqual(factory.closed_sessions, len(outcomes))

    def test_health_only_reports_gateway_readiness(self):
        factory = FakeBrowserFactory()
        with GatewayHarness(factory) as harness:
            status, headers, body = harness.request("GET", "/health")
            head_status, _, head_body = harness.request("HEAD", "/health")

        self.assertEqual(status, 200)
        self.assertEqual(head_status, 200)
        self.assertEqual(headers["X-Gateway-Health"], "startup-only")
        self.assertEqual(body, b"ready\n")
        self.assertEqual(head_body, b"")
        self.assertEqual(factory.created_sessions, 0)

    def test_cloudscraper_uses_the_verified_browser_profile(self):
        expected_session = object()
        with mock.patch.object(
            gateway.cloudscraper,
            "create_scraper",
            return_value=expected_session,
        ) as create_scraper:
            actual_session = gateway.create_browser_session()

        self.assertIs(actual_session, expected_session)
        create_scraper.assert_called_once_with(
            browser={"browser": "chrome", "platform": "windows", "mobile": False},
            interpreter="nodejs",
            delay=10,
        )

    def test_logs_distinguish_direct_origin_from_configured_forwarder_and_redact_sensitive_data(self):
        catalog_body = json.dumps(
            {"plugins": [{"url": "https://kelee.one/Tool/Loon/Plugin/Bilibili.plugin"}]}
        ).encode()
        rule_body = b"DOMAIN,example.com\n"
        challenge_body = b"<!doctype html><html>SECRET-CHALLENGE-BODY</html>"
        outcomes = [
            FakeResponse(
                status_code=200,
                body=catalog_body,
                headers={"Content-Type": "application/json; charset=utf-8"},
            ),
            FakeResponse(
                status_code=403,
                body=b"SECRET-DIRECT-403-BODY",
                headers={"content-type": "text/html; charset=utf-8"},
            ),
            FakeResponse(
                status_code=200,
                body=rule_body,
                headers={"Content-Type": "text/plain; charset=utf-8"},
            ),
            FakeResponse(
                status_code=403,
                body=b"SECRET-FORWARDER-403-BODY",
                headers={"Content-Type": "text/html; charset=utf-8"},
            ),
            FakeResponse(
                status_code=200,
                body=challenge_body,
                headers={"Content-Type": "text/html; charset=utf-8"},
            ),
            FakeResponse(
                status_code=200,
                body=b"{}",
                headers={
                    "Content-Type": "text/plain; charset=utf-8",
                    "Content-Length": str(gateway.MAX_RESPONSE_BYTES + 1),
                },
            ),
            requests.exceptions.Timeout(
                "SECRET-TIMEOUT https://user:pass@worker.example/proxy?token=do-not-log"
            ),
            RuntimeError(
                "SECRET-EXCEPTION https://user:pass@worker.example/proxy?token=do-not-log"
            ),
            FakeResponse(
                status_code=200,
                body=rule_body,
                headers={"Content-Type": "text/plain\r\nSECRET-HEADER"},
            ),
        ]
        factory = FakeBrowserFactory(outcomes)

        with GatewayHarness(factory) as harness:
            catalog = "https://hub.kelee.one/list.json"
            rule = "https://rule.kelee.one/path/test.lsr?secret=query-secret"
            urls = [catalog, catalog] + [rule] * 7
            statuses = [harness.request("GET", rule_path(url))[0] for url in urls]
            logs = harness.log_stream.getvalue()

        self.assertEqual(statuses, [200, 502, 200, 502, 502, 502, 504, 502, 200])
        rows = [dict(field.split("=", 1) for field in line.split()) for line in logs.splitlines()]
        self.assertEqual(len(rows), len(urls))
        expected = [
            ("200", "valid", "application/json", catalog_body),
            ("403", "skipped_non_200", "text/html", None),
            ("200", "valid", "text/plain", rule_body),
            ("403", "skipped_non_200", "text/html", None),
            ("200", "invalid_body", "text/html", challenge_body),
            ("200", "body_too_large", "text/plain", None),
            ("none", "timeout", "none", None),
            ("none", "request_error", "none", None),
            ("200", "valid", "invalid", rule_body),
        ]
        for row, url, status, (responder, validation, media, body) in zip(rows, urls, statuses, expected):
            with self.subTest(url=url, validation=validation):
                self.assertEqual(row["source"], url.split("?")[0])
                self.assertEqual(row["status"], str(status))
                self.assertEqual(row["route"], "direct" if url == catalog else "configured_forwarder")
                self.assertEqual(row["responder_status"], responder)
                self.assertEqual(row["origin_status"], responder if url == catalog else "unobserved")
                self.assertEqual(row["validation"], validation)
                self.assertEqual(row["media_type"], media)
                self.assertEqual(row.get("body_bytes"), str(len(body)) if body is not None else None)
                self.assertEqual(row.get("body_sha256"), hashlib.sha256(body).hexdigest() if body is not None else None)

        # Sensitive data must never appear anywhere in logs
        for forbidden in (
            "worker.example",
            "do-not-log",
            "query-secret",
            "user:pass",
            "SECRET-CHALLENGE-BODY",
            "SECRET-DIRECT-403-BODY",
            "SECRET-FORWARDER-403-BODY",
            "SECRET-TIMEOUT",
            "SECRET-EXCEPTION",
            "SECRET-HEADER",
        ):
            self.assertNotIn(forbidden, logs)

        # public_source_url strips credentials and queries even if called directly
        self.assertEqual(
            gateway.public_source_url("https://user:pass@rule.kelee.one/a.lsr?token=secret"),
            "https://rule.kelee.one/a.lsr",
        )


if __name__ == "__main__":
    unittest.main()
