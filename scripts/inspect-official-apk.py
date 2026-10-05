import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(r"C:\Users\YH\Documents\Codex\2026-09-08\wo\outputs\gold-monitor-desktop")
APK_PATH = Path(r"C:\Users\YH\Downloads\base.apk")
TOOLS = ROOT / ".tools" / "apk-analysis"
OUT = ROOT / "analysis" / "official-apk"
sys.path.insert(0, str(TOOLS))

from androguard.core.apk import APK
from lxml import etree

OUT.mkdir(parents=True, exist_ok=True)
apk = APK(str(APK_PATH))

manifest = apk.get_android_manifest_xml()
(OUT / "AndroidManifest.xml").write_bytes(etree.tostring(manifest, pretty_print=True, encoding="utf-8", xml_declaration=True))

android_ns = "http://schemas.android.com/apk/res/android"
app = manifest.find("application")
def attr(node, name):
    return node.get(f"{{{android_ns}}}{name}") if node is not None else None

components = {}
for kind, getter in (("activities", apk.get_activities), ("services", apk.get_services), ("receivers", apk.get_receivers), ("providers", apk.get_providers)):
    rows = []
    tag = kind[:-1] if kind != "activities" else "activity"
    for name in getter():
        node = next((n for n in manifest.findall(f".//{tag}") if attr(n, "name") == name), None)
        rows.append({
            "name": name,
            "exported": attr(node, "exported"),
            "permission": attr(node, "permission"),
            "intentFilters": apk.get_intent_filters(kind[:-1] if kind != "activities" else "activity", name),
        })
    components[kind] = rows

certificates = []
for der in apk.get_certificates_der_v3() or apk.get_certificates_der_v2() or []:
    certificates.append({"sha256": hashlib.sha256(der).hexdigest().upper(), "bytes": len(der)})

with zipfile.ZipFile(APK_PATH) as archive:
    names = archive.namelist()
    dex_blobs = [archive.read(name) for name in names if name.endswith(".dex")]
    scan_names = [name for name in names if name.endswith((".dex", ".so", ".json", ".properties", ".html", ".js", ".xml"))]
    blobs = [(name, archive.read(name)) for name in scan_names]

ascii_re = re.compile(rb"[\x20-\x7e]{5,}")
all_strings = []
for name, blob in blobs:
    for match in ascii_re.findall(blob):
        try:
            value = match.decode("utf-8")
        except UnicodeDecodeError:
            value = match.decode("latin1", "ignore")
        if len(value) <= 2000:
            all_strings.append((name, value))

url_re = re.compile(r"(?:https?|wss?)://[^\s\"'<>\\]{4,}", re.I)
domain_re = re.compile(r"(?<![\w.-])(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io|top|app|cloud)(?::\d+)?", re.I)
urls = sorted({m.group(0).rstrip(".,);]") for _, s in all_strings for m in url_re.finditer(s)})
domains = sorted({m.group(0).lower() for _, s in all_strings for m in domain_re.finditer(s)})

keywords = [
    "kline", "candlestick", "candle", "market", "quote", "history", "realtime", "websocket", "socket",
    "minute", "period", "ticker", "chart", "hq", "quotation", "trade", "silver", "JZJ_ag", "ag9999",
    "行情", "分时", "蜡烛", "白银", "历史", "实时", "图表", "周期",
]
keyword_hits = {}
for keyword in keywords:
    hits = []
    needle = keyword.lower()
    for name, value in all_strings:
        if needle in value.lower():
            hits.append({"file": name, "text": value[:500]})
            if len(hits) >= 80:
                break
    if hits:
        keyword_hits[keyword] = hits

resource_files = [name for name in names if name.startswith("res/")]
resource_clues = sorted(name for name in resource_files if any(k in name.lower() for k in ("market", "quote", "chart", "kline", "trend", "minute", "trade", "silver", "home", "web")))

summary = {
    "file": {"name": APK_PATH.name, "bytes": APK_PATH.stat().st_size, "sha256": hashlib.sha256(APK_PATH.read_bytes()).hexdigest().upper()},
    "app": {
        "label": apk.get_app_name(), "package": apk.get_package(), "versionName": apk.get_androidversion_name(),
        "versionCode": apk.get_androidversion_code(), "minSdk": apk.get_min_sdk_version(), "targetSdk": apk.get_target_sdk_version(),
        "mainActivity": apk.get_main_activity(), "mainActivities": sorted(apk.get_main_activities()),
        "debuggable": attr(app, "debuggable"), "usesCleartextTraffic": attr(app, "usesCleartextTraffic"),
        "networkSecurityConfig": attr(app, "networkSecurityConfig"), "extractNativeLibs": attr(app, "extractNativeLibs"),
    },
    "signing": {"v1": apk.is_signed_v1(), "v2": apk.is_signed_v2(), "v3": apk.is_signed_v3(), "certificates": certificates},
    "permissions": sorted(apk.get_permissions()),
    "components": components,
    "nativeAbis": sorted({name.split("/")[1] for name in names if name.startswith("lib/") and len(name.split("/")) > 2}),
    "dexFiles": [name for name in names if name.endswith(".dex")],
    "packerSignals": sorted(name for name in names if "jiagu" in name.lower() or "shell" in name.lower()),
    "network": {"urls": urls, "domains": domains},
    "resourceClues": resource_clues,
    "keywordHitCounts": {key: len(value) for key, value in keyword_hits.items()},
}

(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
(OUT / "network-strings.json").write_text(json.dumps({"urls": urls, "domains": domains}, ensure_ascii=False, indent=2), encoding="utf-8")
(OUT / "keyword-hits.json").write_text(json.dumps(keyword_hits, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
