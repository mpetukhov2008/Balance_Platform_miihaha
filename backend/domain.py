"""Domain algorithms. No paths or application-specific rules in the API layer."""
import bisect
import json
from collections import Counter, defaultdict

DEFAULT_PARAMS = {
    "exclude": ["appData.request_id", "appData.createDateTime"],
    "arrays": {
        "decisionResult.available_offers": ["product_id", "type"],
        "decisionResult.product_trials": ["product_id"],
        "decisionResult.product_trials.rules": ["name"],
        "decisionResult.product_trials.scoring.scoreModels": ["modelName"],
        "decisionResult.scoring": ["modelName"],
        "decisionResult.scoring.value": "index",
        "ext_data": ["body.action"],
        "product_catalog": ["mfo_id", "product_id"],
        "tariff_matrix": ["mfo_id", "product_id"],
    },
    "buckets": {},
}


def get(obj, path, default=None):
    for part in path.split("."):
        if not isinstance(obj, dict) or part not in obj:
            return default
        obj = obj[part]
    return obj


def scalar(value):
    if value is None:
        return "NULL"
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def key_part(value):
    # Escape separators without changing ordinary keys expected by supplied checks.
    return scalar(value).replace("%", "%25").replace("|", "%7C").replace("~", "%7E")


def normalize(document, app_id, source, params):
    exclusions = params.get("exclude", [])
    rules = params.get("arrays", {})
    rows = []
    seen = set()

    def walk(value, parts, keys):
        path = ".".join(parts)
        if any(path == x or path.startswith(x + ".") for x in exclusions):
            return
        if isinstance(value, dict):
            for name, item in value.items():
                walk(item, parts + [name], keys)
        elif isinstance(value, list):
            if not value:
                return
            rule = rules.get(path)
            if rule is None:
                raise ValueError(f"Array mode not configured: {path}")
            element_keys = set()
            for index, item in enumerate(value):
                if rule == "index":
                    key = str(index)
                elif rule == "value":
                    if isinstance(item, (dict, list)):
                        raise ValueError(f"Scalar array expected: {path}")
                    key = key_part(item)
                elif isinstance(rule, list) and rule:
                    missing = object()
                    vals = [get(item, field, missing) for field in rule]
                    if any(v is missing for v in vals):
                        raise ValueError(f"Missing array key: {path}")
                    key = "~".join(key_part(v) for v in vals)
                else:
                    raise ValueError(f"Invalid array mode: {path}")
                if key in element_keys:
                    if rule == "value":
                        continue  # set semantics, explicitly configured
                    raise ValueError(f"Duplicate array key at {path}: {key}")
                element_keys.add(key)
                walk(item, parts, keys + [key])
        else:
            array_key = "|".join(keys)
            identity = (path, array_key)
            if identity in seen:
                raise ValueError(f"Duplicate attribute {identity}")
            seen.add(identity)
            adjusted = scalar(value)
            bounds = params.get("buckets", {}).get(path)
            if bounds and isinstance(value, (int, float)) and not isinstance(value, bool):
                if bounds != sorted(set(bounds)):
                    raise ValueError("Bucket bounds must be unique and sorted")
                index = bisect.bisect_left(bounds, value)
                lo = bounds[index - 1] if index else "-inf"
                hi = bounds[index] if index < len(bounds) else "inf"
                adjusted = f"({lo}, {hi}]"
            rows.append({"APP_ID": app_id, "SOURCE": source, "PREFIX": parts[0] if parts else "",
                         "CLASS": parts[1] if len(parts) > 2 else "",
                         "SUFFIX": ".".join(parts[2:-1]), "ARRAY_KEY": array_key,
                         "KEY": parts[-1] if parts else "", "PATH": path,
                         "VALUE": scalar(value), "ADJUSTED_VALUE": adjusted,
                         "valueType": type(value).__name__})
    walk(document, [], [])
    return rows


def compare(rows, params=None):
    sides = defaultdict(dict)
    for row in rows:
        k = row["APP_ID"], row["PATH"], row["ARRAY_KEY"]
        if row["SOURCE"] in sides[k]:
            raise ValueError(f"Duplicate normalized row: {k}")
        sides[k][row["SOURCE"]] = row
    result = []
    for key, pair in sorted(sides.items()):
        b, a = pair.get("BEFORE"), pair.get("AFTER")
        change = "ATTRIBUTE_NEW" if b is None else "ATTRIBUTE_LOST" if a is None else (
            "SAME" if (b["VALUE"], b.get("valueType")) == (a["VALUE"], a.get("valueType")) else "VALUE_CHANGED")
        base = a or b
        r = {k: base[k] for k in ("APP_ID", "PATH", "ARRAY_KEY", "PREFIX", "CLASS", "SUFFIX", "KEY")}
        for side, item in (("BEFORE", b), ("AFTER", a)):
            r[f"VALUE_{side}"] = item["VALUE"] if item else ""
            r[f"ADJUSTED_{side}"] = item["ADJUSTED_VALUE"] if item else ""
        r.update(DIFF_FLAG=int(change != "SAME"), CHANGE_TYPE=change,
                 presentBefore=b is not None, presentAfter=a is not None,
                 valueTypeBefore=b.get("valueType") if b else None,
                 valueTypeAfter=a.get("valueType") if a else None)
        result.append(r)
    return result


def segments(pairs):
    result = []
    for app_id, docs in sorted(pairs.items()):
        r = {"APP_ID": app_id}
        products, partners, routes = set(), set(), set()
        for source in ("BEFORE", "AFTER"):
            doc = docs[source]
            trials = get(doc, "decisionResult.product_trials", [])
            offers = get(doc, "decisionResult.available_offers", [])
            offers = sorted(offers, key=lambda x: (x.get("rank", 10**9), str(x.get("product_id")), x.get("type", "")))
            # Explicit prototype policy: top offer's product, else smallest product_id.
            chosen = next((t for t in trials if offers and t.get("product_id") == offers[0].get("product_id")), None)
            chosen = chosen or next(iter(sorted(trials, key=lambda t: str(t.get("product_id")))), {})
            r[f"DECISION_{source}"] = get(doc, "decisionResult.decision")
            r[f"TOP_OFFER_{source}"] = str(offers[0]["product_id"]) if offers else ""
            for field, path in (("PD_MODEL", "scoring.pd.modelName"), ("CUTOFF", "cutOff.name"), ("REJECT_REASON", "rejectReason")):
                r[f"{field}_{source}"] = get(chosen, path, "")
            r[f"SCORE_OKB_{source}"] = get(doc, "characteristics.score_okb")
            products.update(str(t["product_id"]) for t in trials)
            partners.update(t.get("partner_type", "") for t in trials)
            routes.update(t.get("routing_method", "") for t in trials)
        r.update(PRODUCTS=";".join(sorted(products)), PARTNER_TYPE=";".join(sorted(partners)),
                 ROUTING_METHOD=";".join(sorted(routes)),
                 DECISION_CHANGED=int(r["DECISION_BEFORE"] != r["DECISION_AFTER"]))
        result.append(r)
    return result


FACT_FIELDS = ["PREFIX", "CLASS", "SUFFIX", "ARRAY_KEY", "KEY", "PATH", "VALUE_ADJUSTED", "DIFF_FLAG", "CHANGE_TYPE", "SOURCE"]
SEGMENT_FIELDS = ["PRODUCTS", "PARTNER_TYPE", "ROUTING_METHOD", "DECISION_CHANGED", "DECISION_BEFORE", "DECISION_AFTER"]
DIMENSIONS = FACT_FIELDS + SEGMENT_FIELDS


def aggregate(comparison, segment_rows, params=None):
    seg = {s["APP_ID"]: s for s in segment_rows}
    groups = {}
    for r in comparison:
        for source in ("BEFORE", "AFTER"):
            if not r.get("presentBefore" if source == "BEFORE" else "presentAfter", True):
                continue
            base = {k: r[k] for k in FACT_FIELDS if k not in ("SOURCE", "VALUE_ADJUSTED")}
            base.update(SOURCE=source, VALUE_ADJUSTED=r[f"ADJUSTED_{source}"])
            base.update({k: seg[r["APP_ID"]].get(k) for k in SEGMENT_FIELDS})
            key = tuple(base[k] for k in DIMENSIONS)
            if key not in groups:
                groups[key] = dict(base, APP_IDS=set())
            groups[key]["APP_IDS"].add(r["APP_ID"])
    facts = []
    for g in groups.values():
        g["APP_IDS"] = sorted(g["APP_IDS"])
        g["CNT"] = len(g["APP_IDS"])
        facts.append(g)
    return facts


class Mart:
    """Indexed access object used inside the isolated execution environment."""
    def __init__(self, rows, segments):
        self.data, self.segment_data = rows, segments
        self.indices = {}
        for field in ("PATH", "KEY", "ARRAY_KEY", "DIFF_FLAG", "CHANGE_TYPE", "VALUE_BEFORE", "VALUE_AFTER", "APP_ID"):
            idx = defaultdict(set)
            for i, row in enumerate(rows):
                idx[row[field]].add(i)
            self.indices[field] = idx

    def rows(self, **filters):
        mapping = {"path": "PATH", "key": "KEY", "array_key": "ARRAY_KEY", "diff_flag": "DIFF_FLAG",
                   "change_type": "CHANGE_TYPE", "value_before": "VALUE_BEFORE", "value_after": "VALUE_AFTER", "app_ids": "APP_ID"}
        candidates = None
        for name, value in filters.items():
            if name == "path_prefix":
                continue
            if name not in mapping:
                raise ValueError(f"Unknown mart filter: {name}")
            idx = self.indices[mapping[name]]
            ids = set().union(*(idx.get(v, set()) for v in (value if isinstance(value, list) else [value])))
            candidates = ids if candidates is None else candidates & ids
        for i in (range(len(self.data)) if candidates is None else sorted(candidates)):
            row = self.data[i]
            if "path_prefix" not in filters or row["PATH"].startswith(filters["path_prefix"]):
                yield row

    def count(self, **filters):
        return sum(1 for _ in self.rows(**filters))

    def app_ids(self, **filters):
        return sorted({r["APP_ID"] for r in self.rows(**filters)})

    def segments(self):
        return iter(self.segment_data)

    def total_apps(self):
        return len(self.segment_data)


def summary(rows, seg):
    changed = {r["APP_ID"] for r in rows if r["DIFF_FLAG"]}
    top = defaultdict(set)
    for r in rows:
        if r["DIFF_FLAG"]:
            top[r["PATH"]].add(r["APP_ID"])
    transitions = Counter((s["DECISION_BEFORE"], s["DECISION_AFTER"]) for s in seg)
    drift = {r["APP_ID"] for r in rows if r["PATH"] == "characteristics.score_okb" and r["DIFF_FLAG"]}
    return {"totalApps": len(seg), "changedApps": len(changed), "decisionChangedApps": sum(s["DECISION_CHANGED"] for s in seg),
            "decisionTransitions": [{"before": b, "after": a, "count": n} for (b, a), n in sorted(transitions.items())],
            "topChangedAttributes": [{"PATH": p, "changedApps": len(v)} for p, v in sorted(top.items(), key=lambda x: (-len(x[1]), x[0]))[:20]],
            "externalDriftDecisionApps": len(drift & {s["APP_ID"] for s in seg if s["DECISION_CHANGED"]})}
