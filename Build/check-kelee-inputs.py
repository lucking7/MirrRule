"""Check the configured Kelee inputs from a clean runner without retaining their contents."""
import hashlib
import importlib.util
import json
from pathlib import Path

import requests


def main():
    spec = importlib.util.spec_from_file_location("gateway", Path(__file__).with_name("browser-rule-gateway.py"))
    gateway = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gateway)
    inputs = (
        ("https://hub.kelee.one/list.json", gateway.is_plugin_catalog),
        ("https://kelee.one/Tool/Loon/Lsr/SpeedtestChina.lsr", gateway.is_rule_text),
        ("https://kelee.one/Tool/Loon/Lsr/SpeedtestInternational.lsr", gateway.is_rule_text),
    )
    valid = True
    with requests.Session() as session:
        session.headers["User-Agent"] = "MirrRule/1.0 (+https://github.com/lucking7/MirrRule)"
        for url, check in inputs:
            result = {"source": url, "route": "direct", "valid": False}
            try:
                with session.get(url, timeout=(10, 30), allow_redirects=False, stream=True) as response:
                    result["http"] = response.status_code
                    result["mediaType"] = response.headers.get("Content-Type", "").split(";")[0]
                    body = gateway.read_limited_response(response)
                    if body is not None:
                        result["bytes"] = len(body)
                        result["sha256"] = hashlib.sha256(body).hexdigest()
                        result["valid"] = response.status_code == 200 and check(body)
            except requests.RequestException as error:
                result["error"] = type(error).__name__
            print(json.dumps(result), flush=True)
            valid = valid and result["valid"]
    return 0 if valid else 1


if __name__ == "__main__":
    raise SystemExit(main())
