import copy
import csv
from pathlib import Path
import pytest
from backend.catalog import load_dataset
from backend.domain import DEFAULT_PARAMS, normalize, compare, segments, aggregate, Mart, summary

def pipeline():
    if not Path("Исходники/samples/BEFORE").is_dir():
        pytest.skip("Real source samples are not present in this checkout")
    pairs = load_dataset("samples")
    normalized = [r for id,p in pairs.items() for side,doc in p.items() for r in normalize(doc,id,side,DEFAULT_PARAMS)]
    rows = compare(normalized)
    seg = segments(pairs)
    return normalized, rows, seg

def test_real_samples():
    normalized, rows, seg = pipeline()
    s = summary(rows,seg)
    assert s["totalApps"] == 4
    assert s["decisionChangedApps"] == 2
    assert not any(r["DIFF_FLAG"] for r in rows if r["APP_ID"] == "I32554355")
    assert not any("request_id" in r["PATH"] for r in normalized)
    assert len({(r["APP_ID"],r["PATH"],r["ARRAY_KEY"]) for r in rows}) == len(rows)
    for f in aggregate(rows,seg):
        assert f["CNT"] == len(set(f["APP_IDS"]))
    assert Mart(rows,seg).app_ids(path="decisionResult.decision",diff_flag=1) == ["I32554354","I32554362"]

def test_reordered_keyed_arrays_and_vector_indices():
    if not Path("Исходники/samples/BEFORE").is_dir():
        pytest.skip("Real source samples are not present in this checkout")
    pairs=load_dataset("samples")
    b=pairs["I32554355"]["BEFORE"]
    a=copy.deepcopy(b)
    a["decisionResult"]["product_trials"].reverse()
    a["decisionResult"]["scoring"].reverse()
    rows=compare(normalize(b,"x","BEFORE",DEFAULT_PARAMS)+normalize(a,"x","AFTER",DEFAULT_PARAMS))
    assert all(r["DIFF_FLAG"] == 0 for r in rows)
    a["decisionResult"]["scoring"][0]["value"].reverse()
    assert any(r["DIFF_FLAG"] for r in compare(normalize(b,"x","BEFORE",DEFAULT_PARAMS)+normalize(a,"x","AFTER",DEFAULT_PARAMS)))

def test_missing_null_false_zero_and_bucket():
    p={"exclude":[],"arrays":{},"buckets":{"score":[0.3,0.6]}}
    b={"score":0.42,"nil":None,"false":False,"zero":0,"gone":""}
    a={"score":0.58,"nil":False,"false":0,"zero":0,"new":None}
    rows={r["PATH"]:r for r in compare(normalize(b,"x","BEFORE",p)+normalize(a,"x","AFTER",p))}
    assert rows["score"]["ADJUSTED_BEFORE"] == rows["score"]["ADJUSTED_AFTER"]
    assert rows["score"]["DIFF_FLAG"] == 1
    assert rows["nil"]["CHANGE_TYPE"] == "VALUE_CHANGED"
    assert rows["false"]["CHANGE_TYPE"] == "VALUE_CHANGED"
    assert rows["gone"]["CHANGE_TYPE"] == "ATTRIBUTE_LOST"
    assert rows["new"]["CHANGE_TYPE"] == "ATTRIBUTE_NEW"
    assert rows["zero"]["CHANGE_TYPE"] == "SAME"

def test_duplicate_and_unknown_array_fail():
    with pytest.raises(ValueError,match="Duplicate"):
        normalize({"x":[{"id":1},{"id":1}]},"a","BEFORE",{"arrays":{"x":["id"]}})
    with pytest.raises(ValueError,match="not configured"):
        normalize({"x":[1]},"a","BEFORE",{})

def test_composite_key_and_models_do_not_collapse():
    p={"arrays":{"offers":["id","type"],"models":["name"]}}
    doc={"offers":[{"id":1,"type":"standard"},{"id":1,"type":"manual"}],"models":[{"name":"A","x":1},{"name":"B","x":1}]}
    rows=normalize(doc,"x","BEFORE",p)
    assert len([r for r in rows if r["PATH"]=="models.x"])==2
    assert len([r for r in rows if r["PATH"]=="offers.id"])==2
