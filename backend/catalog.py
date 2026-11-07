import ast
import copy
import json
import os
from pathlib import Path
from backend.domain import DEFAULT_PARAMS
from backend.store import now

ROOT = Path(os.environ.get("SOURCE_ROOT", "Исходники")).resolve()
TEMPLATES = {
    "NORMALIZE": "from backend.domain import normalize\n\ndef run(document, app_id, source, params):\n    return normalize(document, app_id, source, params)\n",
    "COMPARE": "from backend.domain import compare\n\ndef run(rows, params):\n    return compare(rows, params)\n",
    "AGGREGATE": "from backend.domain import aggregate\n\ndef run(rows, segments, params):\n    return aggregate(rows, segments, params)\n",
    "CHECK": 'def run(mart, params):\n    return [{"LABEL":"Пример", "SOURCE":"AFTER", "ARGUMENT":"", "CNT":0, "TOTAL":mart.total_apps(), "METRIC":0, "APP_IDS":[], "RESULT":"PASS", "CONFIDENCE":"HIGH"}]\n\nCHECK = {"id":"custom_check", "label":"Пример", "params":{}, "entrypoint":run}\n',
}

def scripts():
    result = []
    for kind in ("NORMALIZE", "COMPARE", "AGGREGATE"):
        result.append({"id": "builtin-" + kind.lower(), "name": kind, "kind": kind,
            "sourceType": "FILE", "filename": kind.lower() + ".py", "code": TEMPLATES[kind],
            "params": copy.deepcopy(DEFAULT_PARAMS) if kind == "NORMALIZE" else {},
            "contractId": kind.lower() + "-v1", "updatedAt": now(), "checkId": None})
    for path in sorted((ROOT / "checks").glob("check_*.py")):
        code = path.read_text(encoding="utf-8-sig")
        tree = ast.parse(code)
        defaults = {}
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "DEFAULTS" for t in node.targets):
                defaults = ast.literal_eval(node.value)
        name = path.stem.removeprefix("check_")
        result.append({"id": "file-" + path.stem, "name": name, "kind": "CHECK", "sourceType": "FILE",
                       "filename": path.name, "code": code, "params": defaults, "contractId": "check-v1", "updatedAt": now(), "checkId": name})
    return result

def datasets():
    roots = [("samples", ROOT / "samples", "BEFORE", "AFTER", "SAMPLES")]
    full = Path(os.environ.get("FULL_DATA_ROOT", str(ROOT / "data" / "RUN-20260827-0001" / "RESULTS")))
    roots.append(("full", full, "BEFORE_MASTER", "AFTER_BETA", "FULL"))
    return [{"id": id, "name": "Четыре реальные заявки" if id == "samples" else "Полный датасет",
             "kind": kind, "status": "READY" if (p / b).is_dir() and (p / a).is_dir() else "UNAVAILABLE",
             "appCount": len(list((p / b).glob("*.json"))) if (p / b).is_dir() else None,
             "description": "Парные JSON до и после"} for id, p, b, a, kind in roots]

def load_dataset(id):
    if id == "samples":
        root, b, a = ROOT / "samples", "BEFORE", "AFTER"
    elif id == "full":
        root, b, a = Path(os.environ.get("FULL_DATA_ROOT", str(ROOT / "data" / "RUN-20260827-0001" / "RESULTS"))), "BEFORE_MASTER", "AFTER_BETA"
    else:
        raise ValueError("Unknown dataset")
    before, after = {p.stem: p for p in (root / b).glob("*.json")}, {p.stem: p for p in (root / a).glob("*.json")}
    if not before or before.keys() != after.keys():
        raise ValueError("Dataset unavailable or unpaired application files")
    pairs = {}
    for app_id in sorted(before):
        pairs[app_id] = {}
        for source, files in (("BEFORE", before), ("AFTER", after)):
            doc = json.loads(files[app_id].read_text(encoding="utf-8-sig"))
            if doc.get("appData", {}).get("application_id") != app_id:
                raise ValueError("Filename/application_id mismatch")
            pairs[app_id][source] = doc
    return pairs
