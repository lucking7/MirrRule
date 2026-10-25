import importlib.util
import io
import ipaddress
from pathlib import Path
import tempfile
import unittest
from unittest import mock
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
