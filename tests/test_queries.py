from backend.store import Store
from backend import queries
from backend.domain import normalize,compare,aggregate
import os

def fixture(tmp_path):
    db=Store(os.environ.get("TEST_POSTGRES_URL") or "sqlite:///"+str(tmp_path/"queries.db"))
    seg=[]
    n=[]
    for i in range(6):
        aid=str(i)
        seg.append(dict(APP_ID=aid,PRODUCTS="12;312",PARTNER_TYPE="A",ROUTING_METHOD="api",
            DECISION_CHANGED=0,DECISION_BEFORE="APPROVE",DECISION_AFTER="APPROVE"))
        for side in ("BEFORE","AFTER"):
            n+=normalize({"x":i,"y":None},aid,side,{})
    rows=compare(n)
    db.put("result","u",dict(id="r",rows=rows,segments=seg,facts=aggregate(rows,seg),checks=[]))
    return db

def test_sql_pages_filters_and_unique_totals(tmp_path):
    db=fixture(tmp_path)
    rows,cols,cells,total,unique=queries.pivot(db.engine,"u","r",["VALUE_ADJUSTED"],["SOURCE"],[],1,2)
    assert total==7 and unique==6 and len(rows)==2
    assert len(cells)==4
    rows,_,_,total,unique=queries.pivot(db.engine,"u","r",["VALUE_ADJUSTED"],["SOURCE"],[],100,2)
    assert rows==[] and total==7 and unique==6
    for val,count in (("12",6),("2",0),("312",6)):
        result=queries.applications(db.engine,"u","r",[{"field":"PRODUCTS","op":"eq","value":val}],None,1,2)
        assert result["total"]==count
        assert len(result["items"])==min(count,2)
    _,_,cells,total,unique=queries.pivot(db.engine,"u","r",[],[],[{"field":"PATH","op":"in","value":[]}],1,50)
    assert not cells and total==0 and unique==0
    assert queries.applications(db.engine,"other","r",[],None,1,50)["total"]==0

def test_empty_check_membership_and_null_filter(tmp_path):
    db=fixture(tmp_path)
    assert queries.applications(db.engine,"u","r",[],[],1,50)["total"]==0
    result=db.get("result","u","r")
    for f in result["facts"]:
        f["PARTNER_TYPE"]=None
    db.put("result","u",result)
    result=queries.applications(db.engine,"u","r",[{"field":"DECISION_BEFORE","op":"eq","value":"APPROVE"}],None,1,3)
    assert result["total"]==6 and len(result["items"])==3
    assert queries.applications(db.engine,"u","r",[{"field":"PARTNER_TYPE","op":"eq","value":None}],None,1,50)["total"]==6
