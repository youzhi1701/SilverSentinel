import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(r"C:\Users\YH\Documents\Codex\2026-09-08\wo\outputs\gold-monitor-desktop")
sys.path.insert(0, str(ROOT / ".tools" / "apk-analysis"))
from loguru import logger
logger.remove()
from androguard.core.apk import APK
from androguard.core.axml import AXMLPrinter
from androguard.core.dex import DEX
from lxml import etree

APK_PATH = Path(r"C:\Users\YH\Downloads\base.apk")
OUT = ROOT / "analysis" / "official-apk"
OUT.mkdir(parents=True, exist_ok=True)

targets = [
    "res/layout/pj_activity_market_detail.xml",
    "res/layout/pj_fragment_market_detail.xml",
    "res/layout/pj_fragment_market_detail_index_k.xml",
    "res/layout/pj_fragment_market_detail_index_m.xml",
    "res/layout/pj_fragment_market_detail_index_m2.xml",
    "res/layout/pj_fragment_market_detail_index_m_right_rtj.xml",
    "res/layout/pj_layout_market_detail_head.xml",
    "res/layout/pj_layout_market_detail_longpress_kline.xml",
    "res/layout/pj_activity_market_tick.xml",
    "res/layout/pj_dialog_early_warning_add.xml",
    "res/layout/pj_fragment_early_warning.xml",
    "res/layout/pj_item_early_warning_list.xml",
    "res/layout/pj_item_early_warning_list_flex.xml",
    "res/layout/pj_fragment_etf_report.xml",
    "res/layout/pj_item_etf_report_item.xml",
    "res/layout/pj_item_market_detail_realtime.xml",
    "res/layout/pj_item_market_detail_tick.xml",
    "res/layout/pj_layout_market_detail_longpress_mline.xml",
]

decoded = []
with zipfile.ZipFile(APK_PATH) as archive:
    names = set(archive.namelist())
    for name in targets:
        if name not in names:
            continue
        xml = AXMLPrinter(archive.read(name)).get_xml_obj()
        output = OUT / (name.replace("/", "__"))
        output.write_bytes(etree.tostring(xml, pretty_print=True, encoding="utf-8", xml_declaration=True))
        decoded.append(str(output.name))

    for name in sorted(n for n in names if n.startswith("res/xml/") and n.endswith(".xml")):
        try:
            xml = AXMLPrinter(archive.read(name)).get_xml_obj()
            output = OUT / (name.replace("/", "__"))
            output.write_bytes(etree.tostring(xml, pretty_print=True, encoding="utf-8", xml_declaration=True))
            decoded.append(str(output.name))
        except Exception:
            pass

apk = APK(str(APK_PATH))
resources = apk.get_android_resources()
resolved = resources.get_resolved_strings()
(OUT / "resolved-strings.json").write_text(json.dumps(resolved, ensure_ascii=False, indent=2), encoding="utf-8")

dex_summary = {"classes": [], "strings": []}
for dex_bytes in apk.get_all_dex():
    dex = DEX(dex_bytes)
    dex_summary["classes"].extend(str(item.get_name()) for item in dex.get_classes())
    dex_summary["strings"].extend(str(item) for item in dex.get_strings())
dex_summary["classes"] = sorted(set(dex_summary["classes"]))
dex_summary["strings"] = sorted(set(dex_summary["strings"]))
(OUT / "dex-summary.json").write_text(json.dumps(dex_summary, ensure_ascii=False, indent=2), encoding="utf-8")

print(json.dumps({
    "decoded": decoded,
    "packages": resources.get_packages_names(),
    "locales": {p: resources.get_locales(p) for p in resources.get_packages_names()},
    "types": {p: resources.get_types(p) for p in resources.get_packages_names()},
    "dexClassCount": len(dex_summary["classes"]),
    "dexStringCount": len(dex_summary["strings"]),
}, ensure_ascii=False, indent=2))
