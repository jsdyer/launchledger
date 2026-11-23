#!/usr/bin/env python3
"""Capture bounded Launch Library metadata; publish nothing on partial failure."""
from datetime import datetime, timedelta, timezone
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile
import time
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
UUID = re.compile(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
BASES = {"https://ll.thespacedevs.com/2.3.0", "https://lldev.thespacedevs.com/2.3.0"}


def iso(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Invalid source timestamp")
    datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


def text(value, maximum=4000):
    return value[:maximum] if isinstance(value, str) else ""


def normalize(item):
    if not isinstance(item, dict) or not UUID.fullmatch(str(item.get("id", ""))):
        raise ValueError("Invalid launch identifier")
    if not item.get("name") or not isinstance(item.get("status"), dict):
        raise ValueError("Launch missing name or status")
    status = item["status"]
    precision = item.get("net_precision") or {}
    provider = item.get("launch_service_provider") or {}
    pad = item.get("pad") or {}
    location = pad.get("location") or {}
    rocket = (item.get("rocket") or {}).get("configuration") or {}
    mission = item.get("mission") or {}
    return {
        "id": item["id"], "name": text(item["name"], 600),
        "net": iso(item.get("net")), "lastUpdated": iso(item.get("last_updated")),
        "windowStart": iso(item.get("window_start")), "windowEnd": iso(item.get("window_end")),
        "precision": {"name": text(precision.get("name"), 80) or "Not supplied", "description": text(precision.get("description"), 400)},
        "status": {"id": status.get("id"), "name": text(status.get("name"), 100), "description": text(status.get("description"), 600)},
        "provider": text(provider.get("name"), 200) or "Not supplied", "providerId": provider.get("id"),
        "pad": text(pad.get("name"), 200) or "Not supplied", "location": text(location.get("name"), 250),
        "rocket": text(rocket.get("full_name") or rocket.get("name"), 200),
        "mission": text(mission.get("description")), "missionType": text(mission.get("type"), 100),
        "orbit": text((mission.get("orbit") or {}).get("name"), 100),
        "failureReason": text(item.get("failreason"), 1200),
        "sourceUrl": f'https://ll.thespacedevs.com/2.3.0/launches/{item["id"]}/',
    }


def validate_config(c):
    if c.get("apiBase") not in BASES:
        raise ValueError("apiBase must be an approved Launch Library 2 v2.3.0 endpoint")
    for key, low, high in [("lookbackDays", 0, 3650), ("lookaheadDays", 1, 3650), ("pageSize", 1, 100), ("maxPages", 1, 4), ("maxRequests", 1, 8), ("historyLimit", 2, 365)]:
        if type(c.get(key)) is not int or not low <= c[key] <= high:
            raise ValueError(f"{key} must be an integer from {low} to {high}")
    if not isinstance(c.get("search"), str) or len(c["search"]) > 200:
        raise ValueError("search must be text under 201 characters")
    if not re.fullmatch(r"\d*", str(c.get("providerId", ""))):
        raise ValueError("providerId must be blank or numeric")
    ids = c.get("watchIds")
    if not isinstance(ids, list) or len(ids) > 6 or any(not UUID.fullmatch(str(v)) for v in ids) or len(set(ids)) != len(ids):
        raise ValueError("watchIds must contain up to six unique launch UUIDs")
    if c["maxPages"] + len(ids) > c["maxRequests"]:
        raise ValueError("maxPages plus watchIds exceeds maxRequests")
    return c


def collect(config, fetch, now=None):
    c = validate_config(config)
    now = now or datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    start = (now - timedelta(days=c["lookbackDays"])).date().isoformat()
    end = (now + timedelta(days=c["lookaheadDays"])).date().isoformat()
    query = {"mode": "normal", "limit": c["pageSize"], "ordering": "net", "net__gte": start, "net__lt": (now + timedelta(days=c["lookaheadDays"] + 1)).date().isoformat()}
    if c["search"].strip(): query["search"] = c["search"].strip()
    if str(c["providerId"]): query["lsp__id"] = str(c["providerId"])
    request_urls, launches = [], {}
    url = c["apiBase"] + "/launches/?" + urlencode(query)
    total = 0
    for _ in range(c["maxPages"]):
        if not url: break
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.netloc != urlsplit(c["apiBase"]).netloc or parsed.path != "/2.3.0/launches/":
            raise ValueError("Provider pagination points outside the allowed endpoint")
        request_urls.append(url)
        data = fetch(url)
        if not isinstance(data, dict) or not isinstance(data.get("results"), list) or type(data.get("count")) is not int:
            raise ValueError("Invalid launch page; previous capture preserved")
        if len(data["results"]) > c["pageSize"]:
            raise ValueError("Source page exceeds requested bound")
        total = data["count"]
        for item in data["results"]:
            row = normalize(item)
            launches[row["id"]] = row
        url = data.get("next")
        if url is not None and not isinstance(url, str): raise ValueError("Invalid pagination")
    if url:
        raise ValueError("Configured window exceeds maxPages; narrow the window/search or increase maxPages within the request budget. Previous capture preserved")
    window_count = len(launches)
    for uid in c["watchIds"]:
        if uid in launches: continue
        watch_url = f'{c["apiBase"]}/launches/{uid}/?mode=normal'
        request_urls.append(watch_url)
        row = normalize(fetch(watch_url))
        if row["id"] != uid: raise ValueError("Watch response identifier mismatch")
        launches[uid] = row
    # A truly empty query is valid, but an unexplained empty page is not.
    if total and not window_count: raise ValueError("Source reports launches but returned none")
    scope = {"from": start, "through": end, "search": c["search"].strip(), "providerId": str(c["providerId"]), "watchIds": c["watchIds"], "maxPages": c["maxPages"], "pageSize": c["pageSize"]}
    return {"schemaVersion": 1, "capturedAt": stamp, "source": "The Space Devs · Launch Library 2 v2.3.0", "scope": scope,
            "coverage": {"partial": bool(url), "sourceCount": total, "windowCount": window_count, "requests": len(request_urls)},
            "requestUrls": request_urls, "launches": sorted(launches.values(), key=lambda r: (r["net"] or "9999", r["id"]))}


def save_capture(capture, directory, limit=120):
    directory.mkdir(parents=True, exist_ok=True)
    index_path = directory / "index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {"schemaVersion": 1, "captures": []}
    payload = json.dumps(capture, ensure_ascii=False, indent=2) + "\n"
    digest = hashlib.sha256(payload.encode()).hexdigest()
    filename = capture["capturedAt"].replace(":", "").replace("-", "") + "-" + digest[:8] + ".json"
    entry = {"file": filename, "capturedAt": capture["capturedAt"], "count": len(capture["launches"]), "partial": capture["coverage"]["partial"], "sha256": digest}
    entries = [entry] + [x for x in index["captures"] if x["file"] != filename]
    entries.sort(key=lambda x: x["capturedAt"], reverse=True)
    kept, dropped = entries[:limit], entries[limit:]
    updated = {"schemaVersion": 1, "firstCapturedAt": index.get("firstCapturedAt", capture["capturedAt"]), "lastSuccessfulAt": capture["capturedAt"], "retentionLimit": limit, "captures": kept}
    # Capture is fully validated before any persisted data changes. Write index last.
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False, encoding="utf-8") as temp:
        temp.write(payload)
        temporary = Path(temp.name)
    temporary.replace(directory / filename)
    staged = directory / "index.json.tmp"
    staged.write_text(json.dumps(updated, indent=2) + "\n")
    staged.replace(index_path)
    for entry in dropped:
        file = directory / Path(entry["file"]).name
        if file.name != "index.json": file.unlink(missing_ok=True)
    return filename


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, default=ROOT / "web/config.json")
    parser.add_argument("--output", type=Path, default=ROOT / "web/data")
    args = parser.parse_args()
    config = validate_config(json.loads(args.config.read_text()))
    calls = 0
    def fetch(url):
        nonlocal calls
        if calls >= config["maxRequests"]: raise ValueError("Request budget exhausted")
        if calls: time.sleep(1)
        calls += 1
        request = Request(url, headers={"Accept": "application/json", "User-Agent": "CoolCode LaunchLedger/1.0 (+https://coolcode.ca/launchledger/)"})
        with urlopen(request, timeout=40) as response:
            if "json" not in response.headers.get("Content-Type", ""): raise ValueError("Provider returned non-JSON")
            raw = response.read(12_000_001)
            if len(raw) > 12_000_000: raise ValueError("Response exceeds 12 MB safety bound")
            return json.loads(raw)
    capture = collect(config, fetch)
    file = save_capture(capture, args.output, config["historyLimit"])
    print(f'Saved {len(capture["launches"])} launches in {file}; {calls} requests; partial={capture["coverage"]["partial"]}')


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        raise SystemExit(f"Capture failed; last good data unchanged: {exc}")
