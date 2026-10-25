"""Build GeoIP/country.mmdb: geoip-all-in-one countries with China ranges from chnroutes2.

geoip-all-in-one votes on the country of each range across six databases and publishes a
GeoIP2-City file of about 115 MiB, over the 25 MiB Cloudflare Pages asset limit. This script
keeps only its country codes, marks the Sukka china_ip lists (chnroutes2 for IPv4) as CN on
top, and writes a country-only MaxMind database with the Loyalsoldier/geoip converter.

China ranges are added, not substituted: geoip-all-in-one CN ranges that chnroutes2 omits,
such as AWS China regions, stay CN.
"""

from __future__ import annotations

import argparse
import collections
import io
import ipaddress
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

import maxminddb

AIO_RELEASE_API = "https://api.github.com/repos/daijro/geoip-all-in-one/releases/latest"
AIO_ASSET = "geoip-aio-all.mmdb.zip"
CHINA_SOURCES = {
    "ipv4": "https://ruleset.skk.moe/List/ip/china_ip.conf",
    "ipv6": "https://ruleset.skk.moe/List/ip/china_ip_ipv6.conf",
}
OUTPUT_RELATIVE = Path("GeoIP") / "country.mmdb"
# Cloudflare Pages rejects a single asset above 25 MiB; publication-stage.ts enforces the same.
MAX_OUTPUT_BYTES = 25 * 1024 * 1024
MIN_OUTPUT_BYTES = 1024 * 1024
MIN_COUNTRIES = 200
# IPv6 ranges that alias IPv4 space; the MaxMind writer refuses to insert into them.
ALIASED_IPV6 = tuple(
    ipaddress.ip_network(network)
    for network in ("::/96", "::ffff:0:0/96", "64:ff9b::/96", "2001::/32", "2002::/16")
)
SPOT_CHECKS = {
    "114.114.114.114": "CN",
    "223.5.5.5": "CN",
    "8.8.8.8": "US",
    "192.168.1.1": "PRIVATE",
}


def fetch(url: str, token: str | None = None) -> bytes:
    headers = {"User-Agent": "MirrRule-geoip-country"}
    if token and url.startswith("https://api.github.com/"):
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def resolve_aio_asset(release: dict) -> tuple[str, str]:
    for asset in release.get("assets", []):
        if asset.get("name") == AIO_ASSET:
            return release["tag_name"], asset["browser_download_url"]
    raise RuntimeError(f"release {release.get('tag_name')} has no {AIO_ASSET}")


def extract_mmdb(archive: bytes) -> bytes:
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        names = [name for name in bundle.namelist() if name.endswith(".mmdb")]
        if len(names) != 1:
            raise RuntimeError(f"expected one .mmdb in {AIO_ASSET}, found {names}")
        return bundle.read(names[0])


def country_code(record: object) -> str | None:
    if not isinstance(record, dict):
        return None
    code = (record.get("country") or {}).get("iso_code")
    if isinstance(code, str) and len(code) == 2 and code.isalpha():
        return code.upper()
    return None


def is_aliased(network: ipaddress.IPv4Network | ipaddress.IPv6Network) -> bool:
    return network.version == 6 and any(network.overlaps(alias) for alias in ALIASED_IPV6)


def strip_countries(reader, output_dir: Path) -> dict[str, int]:
    """Write one CIDR list per country code; the converter names each list after its file."""
    networks: dict[str, list[str]] = collections.defaultdict(list)
    for network, record in reader:
        code = country_code(record)
        if code and not is_aliased(network):
            networks[code.lower()].append(str(network))
    output_dir.mkdir(parents=True, exist_ok=True)
    for code, values in networks.items():
        (output_dir / f"{code}.txt").write_text("\n".join(values) + "\n", encoding="utf-8")
    return {code: len(values) for code, values in networks.items()}


def converter_config(countries_dir: Path, china_files: dict[str, Path], output_dir: Path) -> dict:
    inputs = [{"type": "text", "action": "add", "args": {"inputDir": str(countries_dir)}}]
    for ip_type, path in china_files.items():
        inputs.append({
            "type": "surgeRuleSet",
            "action": "add",
            "args": {"name": "cn", "uri": str(path), "onlyIPType": ip_type},
        })
    inputs.append({"type": "private", "action": "add"})
    return {
        "input": inputs,
        "output": [{
            "type": "maxmindMMDB",
            "action": "output",
            # Later lists win where ranges overlap, so CN and private ranges override the vote.
            "args": {"outputDir": str(output_dir), "outputName": OUTPUT_RELATIVE.name, "overwriteList": ["cn", "private"]},
        }],
    }


def china_sample_addresses(conf_text: str) -> list[str]:
    samples = []
    for line in conf_text.splitlines():
        fields = line.strip().split(",")
        if len(fields) >= 2 and fields[0] in ("IP-CIDR", "IP-CIDR6"):
            network = ipaddress.ip_network(fields[1], strict=False)
            samples.append(str(network.network_address + network.num_addresses // 2))
    return samples


def verify_output(path: Path, china_samples: list[str]) -> dict:
    size = path.stat().st_size
    if not MIN_OUTPUT_BYTES <= size <= MAX_OUTPUT_BYTES:
        raise RuntimeError(f"{path} is {size} bytes, outside {MIN_OUTPUT_BYTES}..{MAX_OUTPUT_BYTES}")
    with maxminddb.open_database(str(path)) as reader:
        countries = set()
        for _, record in reader:
            code = ((record or {}).get("country") or {}).get("iso_code")
            if code:
                countries.add(code)
        if len(countries) < MIN_COUNTRIES:
            raise RuntimeError(f"{path} has {len(countries)} country codes, expected at least {MIN_COUNTRIES}")
        failures = []
        for address, expected in SPOT_CHECKS.items():
            actual = ((reader.get(address) or {}).get("country") or {}).get("iso_code")
            if actual != expected:
                failures.append(f"{address}: {actual} != {expected}")
        missing_cn = [address for address in china_samples if ((reader.get(address) or {}).get("country") or {}).get("iso_code") != "CN"]
        if missing_cn:
            failures.append(f"{len(missing_cn)} china_ip ranges are not CN, e.g. {missing_cn[:3]}")
        if failures:
            raise RuntimeError("; ".join(failures))
    return {"bytes": size, "countries": len(countries), "chinaSamples": len(china_samples)}


def build(public_dir: Path, tool: str, work_dir: Path, token: str | None) -> dict:
    tag, asset_url = resolve_aio_asset(json.loads(fetch(AIO_RELEASE_API, token)))
    source = work_dir / "geoip-aio-all.mmdb"
    source.write_bytes(extract_mmdb(fetch(asset_url)))
    with maxminddb.open_database(str(source)) as reader:
        counts = strip_countries(reader, work_dir / "countries")
    if len(counts) < MIN_COUNTRIES:
        raise RuntimeError(f"geoip-all-in-one {tag} has {len(counts)} country codes")

    china_files, china_samples = {}, []
    for ip_type, url in CHINA_SOURCES.items():
        text = fetch(url).decode("utf-8")
        samples = china_sample_addresses(text)
        if not samples:
            raise RuntimeError(f"{url} has no IP-CIDR rules")
        china_samples += samples
        china_files[ip_type] = work_dir / f"china_{ip_type}.conf"
        china_files[ip_type].write_text(text, encoding="utf-8")

    output_dir = work_dir / "output"
    config = work_dir / "config.json"
    config.write_text(json.dumps(converter_config(work_dir / "countries", china_files, output_dir)), encoding="utf-8")
    subprocess.run([tool, "convert", "-c", str(config)], check=True, cwd=work_dir)

    built = output_dir / OUTPUT_RELATIVE.name
    report = verify_output(built, china_samples)
    target = public_dir / OUTPUT_RELATIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.tmp")
    shutil.copyfile(built, temporary)
    os.replace(temporary, target)
    return {"source": tag, **report}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--public", type=Path, default=Path("public"))
    parser.add_argument("--tool", default="geoip", help="Loyalsoldier/geoip converter binary")
    args = parser.parse_args(argv)
    with tempfile.TemporaryDirectory(prefix="geoip-country-") as work:
        report = build(args.public, args.tool, Path(work), os.environ.get("GITHUB_TOKEN"))
    print(json.dumps({"output": str(args.public / OUTPUT_RELATIVE), **report}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
