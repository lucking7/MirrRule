"""Check the direct inputs used by the internal CI run. Log metadata only."""
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path

import requests


def probe(session, url, validator, read_body):
    result = {"source": url, "route": "direct", "valid": False}
    try:
        with session.get(url, timeout=(10, 30), allow_redirects=False, stream=True) as response:
            result["http"] = response.status_code
            result["mediaType"] = response.headers.get("Content-Type", "").split(";")[0]
            if response.headers.get("CF-Ray"):
                result["cfRay"] = response.headers["CF-Ray"]
            body = read_body(response)
            if body is not None:
                result["bytes"] = len(body)
                result["sha256"] = hashlib.sha256(body).hexdigest()
                result["valid"] = response.status_code == 200 and validator(body)
                if response.status_code == 403 and result.get("cfRay"):
                    code = re.search(rb"error code:\s*(10\d\d)\b", body, re.I)
                    if code:
                        result["cfError"] = int(code[1])
    except requests.RequestException as error:
        result["error"] = type(error).__name__
    print(json.dumps(result), flush=True)
    return result["valid"]


def main():
    spec = importlib.util.spec_from_file_location("gateway", Path(__file__).with_name("browser-rule-gateway.py"))
    gateway = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gateway)
    inputs = (
        ("catalog", "https://hub.kelee.one/list.json", gateway.is_plugin_catalog),
        ("china", "https://kelee.one/Tool/Loon/Lsr/SpeedtestChina.lsr", gateway.is_rule_text),
        ("international", "https://kelee.one/Tool/Loon/Lsr/SpeedtestInternational.lsr", gateway.is_rule_text),
        ("plugin", "https://kelee.one/Tool/Loon/Lpx/Block_HTTPDNS.lpx", gateway.is_plugin_text),
        ("script", "https://kelee.one/Resource/JavaScript/Amap/Amap_remove_ads.js", gateway.is_script_text),
    )
    with requests.Session() as session:
        session.headers["User-Agent"] = "MirrRule/1.0 (+https://github.com/lucking7/MirrRule)"
        results = {name: probe(session, url, check, gateway.read_limited_response) for name, url, check in inputs}
    if output := os.environ.get("GITHUB_OUTPUT"):
        with open(output, "a", encoding="utf-8") as stream:
            for name, valid in results.items():
                print(f"{name}={str(valid).lower()}", file=stream)
    return 0 if all(results.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())
