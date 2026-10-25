import contextlib
import http.client
import importlib.util
import io
import ipaddress
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import urllib.error
import zipfile


MODULE_PATH = Path(__file__).parents[1] / "build-geoip-country.py"
SPEC = importlib.util.spec_from_file_location("build_geoip_country", MODULE_PATH)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)

AIO_OTHER = "geoip-aio-ipv4.mmdb.zip"


class FakeReader:
    def __init__(self, records, lookups=None):
        self.records = records
        self.lookups = lookups or {}

    def __iter__(self):
        return iter(self.records)

    def get(self, address):
        return self.lookups.get(address)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def country(code):
    return {"country": {"iso_code": code}}


class StripTest(unittest.TestCase):
    def test_keeps_only_country_codes_and_skips_aliased_ipv6(self):
        records = [
            (ipaddress.ip_network("1.0.0.0/24"), {"country": {"iso_code": "AU"}, "location": {"latitude": 1}}),
            (ipaddress.ip_network("1.0.1.0/24"), country("au")),
            (ipaddress.ip_network("2001::/32"), country("US")),
            (ipaddress.ip_network("2400::/32"), country("CN")),
            (ipaddress.ip_network("9.9.9.0/24"), country("EU1")),
            (ipaddress.ip_network("8.8.8.0/24"), {"location": {"latitude": 2}}),
        ]
        with tempfile.TemporaryDirectory() as work:
            counts = builder.strip_countries(FakeReader(records), Path(work))
            self.assertEqual(counts, {"au": 2, "cn": 1})
            self.assertEqual((Path(work) / "au.txt").read_text(), "1.0.0.0/24\n1.0.1.0/24\n")

    def test_china_and_private_lists_override_the_vote(self):
        config = builder.converter_config(Path("countries"), {"ipv4": Path("v4.conf"), "ipv6": Path("v6.conf")}, Path("out"))
        self.assertEqual(config["output"][0]["args"]["overwriteList"], ["cn", "private"])
        self.assertNotIn("sourceMMDBURI", config["output"][0]["args"], "the output must not copy City fields")
        china = [item["args"] for item in config["input"] if item["type"] == "surgeRuleSet"]
        self.assertEqual([(item["name"], item["onlyIPType"]) for item in china], [("cn", "ipv4"), ("cn", "ipv6")])
        self.assertFalse(any(item["type"] == "cutter" for item in config["input"]), "CN ranges are added, not substituted")

    def test_china_samples_use_each_range_midpoint(self):
        text = "# comment\nIP-CIDR,1.0.1.0/24\nIP-CIDR6,2400::/32,no-resolve\nDOMAIN,example.cn\n"
        self.assertEqual(builder.china_sample_addresses(text), ["1.0.1.128", "2400:0:8000::"])


class SourceTest(unittest.TestCase):
    def test_requires_the_country_archive_asset(self):
        release = {"tag_name": "v1", "assets": [{"name": AIO_OTHER, "browser_download_url": "x"}]}
        with self.assertRaisesRegex(RuntimeError, "no geoip-aio-all.mmdb.zip"):
            builder.resolve_aio_asset(release)
        release["assets"].append({"name": builder.AIO_ASSET, "browser_download_url": "https://example.test/a.zip"})
        self.assertEqual(builder.resolve_aio_asset(release), ("v1", "https://example.test/a.zip"))

    def test_archive_must_hold_exactly_one_database(self):
        def archive(*names):
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as bundle:
                for name in names:
                    bundle.writestr(name, b"data-" + name.encode())
            return buffer.getvalue()

        self.assertEqual(builder.extract_mmdb(archive("a.mmdb", "README")), b"data-a.mmdb")
        with self.assertRaises(RuntimeError):
            builder.extract_mmdb(archive("a.mmdb", "b.mmdb"))



class FetchTest(unittest.TestCase):
    def test_retries_transient_failures_then_returns_body(self):
        errors = [
            *(urllib.error.HTTPError("https://example.test", code, "transient", {}, None) for code in (408, 429, 500, 502, 503, 599)),
            urllib.error.URLError("temporary DNS failure"),
            ConnectionResetError("reset"),
            TimeoutError("timed out"),
        ]
        for error in errors:
            with self.subTest(error=error), mock.patch.object(builder.urllib.request, "urlopen", side_effect=[error, io.BytesIO(b"database")]) as urlopen:
                sleep = mock.Mock()
                self.assertEqual(builder.fetch("https://example.test", sleep=sleep), b"database")
                self.assertEqual(urlopen.call_count, 2)
                sleep.assert_called_once_with(1)

    def test_retries_body_read_errors(self):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.side_effect = http.client.IncompleteRead(b"partial")
        with mock.patch.object(builder.urllib.request, "urlopen", side_effect=[response, io.BytesIO(b"complete")]):
            sleep = mock.Mock()
            self.assertEqual(builder.fetch("https://example.test", sleep=sleep), b"complete")
            sleep.assert_called_once_with(1)
            response.__exit__.assert_called_once()

    def test_stops_after_four_attempts_with_exponential_backoff(self):
        error = urllib.error.URLError("offline")
        with mock.patch.object(builder.urllib.request, "urlopen", side_effect=error) as urlopen:
            sleep = mock.Mock()
            with self.assertRaises(urllib.error.URLError) as raised:
                builder.fetch("https://example.test", sleep=sleep)
            self.assertIs(raised.exception, error)
            self.assertEqual(urlopen.call_count, 4)
            self.assertEqual(sleep.call_args_list, [mock.call(1), mock.call(2), mock.call(4)])

    def test_other_http_errors_fail_without_retry(self):
        for code in (400, 401, 403, 404):
            error = urllib.error.HTTPError("https://example.test", code, "permanent", {}, None)
            with self.subTest(code=code), mock.patch.object(builder.urllib.request, "urlopen", side_effect=error) as urlopen:
                sleep = mock.Mock()
                with self.assertRaises(urllib.error.HTTPError):
                    builder.fetch("https://example.test", sleep=sleep)
                urlopen.assert_called_once()
                sleep.assert_not_called()

    def test_success_keeps_timeout_and_scopes_token_to_github_api(self):
        for url in (builder.AIO_RELEASE_API, "https://example.test/archive.zip"):
            with self.subTest(url=url), mock.patch.object(builder.urllib.request, "urlopen", return_value=io.BytesIO(b"ok")) as urlopen:
                sleep = mock.Mock()
                self.assertEqual(builder.fetch(url, "secret", sleep=sleep), b"ok")
                request = urlopen.call_args.args[0]
                self.assertEqual(request.get_header("Authorization"), "Bearer secret" if url == builder.AIO_RELEASE_API else None)
                self.assertEqual(urlopen.call_args.kwargs, {"timeout": 300})
                sleep.assert_not_called()


class FallbackTest(unittest.TestCase):
    def setUp(self):
        work = tempfile.TemporaryDirectory()
        self.addCleanup(work.cleanup)
        self.root = Path(work.name)
        self.public = self.root / "public"
        self.baseline = self.root / "baseline"
        self.source = self.baseline / builder.OUTPUT_RELATIVE
        self.target = self.public / builder.OUTPUT_RELATIVE

    def create_source(self, size=None):
        self.source.parent.mkdir(parents=True, exist_ok=True)
        with self.source.open("wb") as output:
            output.truncate(builder.MIN_OUTPUT_BYTES if size is None else size)

    def run_failure(self, fallback=True, error=None):
        argv = ["--public", str(self.public)]
        if fallback:
            argv += ["--fallback-tree", str(self.baseline)]
        output = io.StringIO()
        with mock.patch.object(builder, "build", side_effect=error or RuntimeError("upstream unavailable")), contextlib.redirect_stdout(output):
            self.assertEqual(builder.main(argv), 0)
        self.assertIn("::warning::GeoIP country build failed:", output.getvalue())
        return output.getvalue()

    def test_reuses_accepted_database_atomically_on_failure(self):
        self.create_source()
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(b"old candidate")
        reader = FakeReader([], {"8.8.8.8": country("US")})
        with (
            mock.patch.object(builder.maxminddb, "open_database", return_value=reader) as opened,
            mock.patch.object(builder.os, "replace", wraps=builder.os.replace) as replace,
        ):
            output = self.run_failure(error=FileNotFoundError("converter missing"))
        opened.assert_called_once_with(str(self.source))
        self.assertIn("FileNotFoundError: converter missing", output)
        self.assertIn("previous database is reused", output)
        self.assertEqual(self.target.read_bytes(), self.source.read_bytes())
        replace.assert_called_once()
        self.assertEqual(replace.call_args.args[0].parent, self.target.parent)
        self.assertEqual(replace.call_args.args[1], self.target)
        self.assertEqual(list(self.target.parent.iterdir()), [self.target])

    def test_no_fallback_does_not_write_a_database(self):
        for supplied in (False, True):
            with self.subTest(supplied=supplied):
                output = self.run_failure(fallback=supplied)
                self.assertIn("country.mmdb was not written", output)
                self.assertFalse(self.target.exists())

    def test_rejects_out_of_bounds_fallback_without_opening(self):
        for size in (builder.MIN_OUTPUT_BYTES - 1, builder.MAX_OUTPUT_BYTES + 1):
            with self.subTest(size=size):
                self.create_source(size)
                with mock.patch.object(builder.maxminddb, "open_database") as opened:
                    output = self.run_failure()
                self.assertIn("outside", output)
                opened.assert_not_called()
                self.assertFalse(self.target.exists())

    def test_rejects_corrupt_database_with_real_maxmind_reader(self):
        self.create_source()
        output = self.run_failure()
        self.assertIn("no usable fallback", output)
        self.assertFalse(self.target.exists())

    def test_rejects_fallback_without_a_country(self):
        self.create_source()
        for record in (None, {}, country(""), country("PRIVATE")):
            with self.subTest(record=record), mock.patch.object(builder.maxminddb, "open_database", return_value=FakeReader([], {"8.8.8.8": record})):
                output = self.run_failure()
                self.assertIn("8.8.8.8 has no country code", output)
                self.assertFalse(self.target.exists())

    def test_failed_copy_warns_and_cleans_up_without_replacing_target(self):
        self.create_source()
        self.target.parent.mkdir(parents=True)
        self.target.write_bytes(b"existing")
        with (
            mock.patch.object(builder.maxminddb, "open_database", return_value=FakeReader([], {"8.8.8.8": country("US")})),
            mock.patch.object(builder.shutil, "copyfile", side_effect=OSError("disk full")),
        ):
            output = self.run_failure()
        self.assertIn("disk full", output)
        self.assertEqual(self.target.read_bytes(), b"existing")
        self.assertEqual(list(self.target.parent.iterdir()), [self.target])

    def test_warning_escapes_multiline_errors(self):
        output = self.run_failure(error=RuntimeError("50%\r\nfailed"))
        self.assertIn("50%25%0D%0Afailed", output)
        self.assertEqual(len(output.splitlines()), 1)

    def test_success_publishes_new_database_without_reading_fallback(self):
        def convert(command, **kwargs):
            config = json.loads(Path(command[-1]).read_text())
            output = Path(config["output"][0]["args"]["outputDir"])
            output.mkdir()
            (output / builder.OUTPUT_RELATIVE.name).write_bytes(b"fresh database")

        release = {"tag_name": "v1", "assets": [{"name": builder.AIO_ASSET, "browser_download_url": "https://example.test/a.zip"}]}
        responses = [json.dumps(release).encode(), b"archive", b"IP-CIDR,1.0.1.0/24", b"IP-CIDR6,2400::/32"]
        output = io.StringIO()
        with (
            mock.patch.object(builder, "fetch", side_effect=responses),
            mock.patch.object(builder, "extract_mmdb", return_value=b"source"),
            mock.patch.object(builder.maxminddb, "open_database", return_value=FakeReader([])),
            mock.patch.object(builder, "strip_countries", return_value={str(i): 1 for i in range(builder.MIN_COUNTRIES)}),
            mock.patch.object(builder.subprocess, "run", side_effect=convert),
            mock.patch.object(builder, "verify_output", return_value={"bytes": 14}) as verify,
            mock.patch.object(builder, "reuse_database") as reuse,
            contextlib.redirect_stdout(output),
        ):
            self.assertEqual(builder.main(["--public", str(self.public), "--tool", "converter", "--fallback-tree", str(self.baseline)]), 0)
        self.assertEqual(self.target.read_bytes(), b"fresh database")
        self.assertEqual(verify.call_args.args[1], ["1.0.1.128", "2400:0:8000::"])
        reuse.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), {"output": str(self.target), "source": "v1", "bytes": 14})

    def test_invalid_arguments_still_fail(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
            builder.main(["--fallback-tree"])
        self.assertEqual(raised.exception.code, 2)


class VerifyTest(unittest.TestCase):
    def verify(self, records, lookups, size=5 * 1024 * 1024, samples=("1.0.1.128",)):
        with tempfile.NamedTemporaryFile() as output:
            output.truncate(size)
            with mock.patch.object(builder.maxminddb, "open_database", return_value=FakeReader(records, lookups)):
                return builder.verify_output(Path(output.name), list(samples))

    def setUp(self):
        self.records = [(None, country(f"{chr(65 + i // 26)}{chr(65 + i % 26)}")) for i in range(builder.MIN_COUNTRIES)]
        self.lookups = {address: country(code) for address, code in builder.SPOT_CHECKS.items()}
        self.lookups["1.0.1.128"] = country("CN")

    def test_accepts_a_complete_database(self):
        report = self.verify(self.records, self.lookups)
        self.assertEqual(report["countries"], builder.MIN_COUNTRIES)

    def test_rejects_china_ranges_that_are_not_cn(self):
        self.lookups["1.0.1.128"] = country("HK")
        with self.assertRaisesRegex(RuntimeError, "1 china_ip ranges are not CN"):
            self.verify(self.records, self.lookups)

    def test_rejects_missing_countries_and_oversized_files(self):
        with self.assertRaisesRegex(RuntimeError, "country codes"):
            self.verify(self.records[:10], self.lookups)
        with self.assertRaisesRegex(RuntimeError, "outside"):
            self.verify(self.records, self.lookups, size=builder.MAX_OUTPUT_BYTES + 1)


if __name__ == "__main__":
    unittest.main()
