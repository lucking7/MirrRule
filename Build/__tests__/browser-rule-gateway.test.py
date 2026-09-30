import http.client
import importlib.util
import io
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


if __name__ == "__main__":
    unittest.main()
