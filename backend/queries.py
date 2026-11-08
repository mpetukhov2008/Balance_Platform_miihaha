"""Database-side aggregation and membership queries, SQLite/PostgreSQL compatible."""
from sqlalchemy import select, func, or_, and_, literal, tuple_
from backend.store import records, fact_members

MULTI={"PRODUCTS","PARTNER_TYPE","ROUTING_METHOD"}
NUMERIC={"DIFF_FLAG","DECISION_CHANGED"}

def field(name, table=records):
    column={"PATH":"path", "DIFF_FLAG":"diff_flag", "CHANGE_TYPE":"change_type"}.get(name)
    if column:
        return table.c[column]
    element=table.c.payload[name]
    return element.as_integer() if name in NUMERIC else element.as_string()

def predicates(filters, table=records):
    result=[]
    for f in filters:
        expr=field(f["field"],table)
        vals=f["value"] if f["op"]=="in" else [f["value"]]
        if f["field"] in MULTI and f["op"]!="exact":
            # Match a complete semicolon-delimited member; LIKE literals escaped.
            wrapped=literal(";")+expr+literal(";")
            options=[expr.is_(None) if v is None else wrapped.contains(";"+str(v)+";",autoescape=True) for v in vals]
            result.append(or_(*options) if options else literal(False))
        else:
            options=[expr.in_([v for v in vals if v is not None])]
            if None in vals:
                options.append(expr.is_(None))
            result.append(or_(*options))
    return result

def fact_scope(owner,run_id,filters):
    return [records.c.owner==owner,records.c.run_id==run_id,records.c.section=="facts",*predicates(filters)]

def member_query(owner,run_id,filters):
    members=select(fact_members.c.app_id).where(fact_members.c.run_id==run_id,fact_members.c.owner==owner)
    if not filters:
        # All memberships already belong to this report: no fact JSON or semi-join needed.
        return members.distinct()
    # PostgreSQL may flatten IN(subquery) and re-evaluate large JSON per member.
    # A materialized CTE preserves the intended single evaluation of fact filters.
    ordinals=select(records.c.ordinal).where(*fact_scope(owner,run_id,filters)).cte('matching_facts')
    ordinals=ordinals.prefix_with('MATERIALIZED',dialect='postgresql')
    return members.where(fact_members.c.fact_ordinal.in_(select(ordinals.c.ordinal))).distinct()

def pivot(engine,owner,run_id,row_fields,col_fields,filters,page,page_size):
    scope=fact_scope(owner,run_id,filters)
    re=[field(k).label("r"+str(i)) for i,k in enumerate(row_fields)]
    ce=[field(k).label("c"+str(i)) for i,k in enumerate(col_fields)]
    with engine.connect() as c:
        exists=c.execute(select(records.c.ordinal).where(*scope).limit(1)).first() is not None
        if not exists:
            return [],[],[],0,0
        rq=select(*re).where(*scope).distinct() if re else select(literal(1).label("empty"))
        total=c.execute(select(func.count()).select_from(rq.subquery())).scalar_one()
        chosen=list(c.execute(rq.order_by(*re).offset((page-1)*page_size).limit(page_size)).tuples())
        row_keys=[tuple(x) if re else () for x in chosen]
        cq=select(*ce).where(*scope).distinct().order_by(*ce).limit(201) if ce else select(literal(1))
        col_keys=[tuple(x) if ce else () for x in c.execute(cq).tuples()]
        if len(col_keys)>200:
            raise ValueError("PIVOT_TOO_WIDE")
        unique=c.execute(select(func.count()).select_from(member_query(owner,run_id,filters).subquery())).scalar_one()
        if not row_keys:
            return [],col_keys,[],total,unique
        selected=[]
        if re:
            selected=[or_(*(and_(*(field(k).is_(None) if v is None else field(k)==v for k,v in zip(row_fields,key))) for key in row_keys))]
        stmt=select(*re,*ce,func.sum(records.c.payload["CNT"].as_integer()).label("value")).where(*scope,*selected)
        if re or ce:
            stmt=stmt.group_by(*re,*ce)
        cells=[]
        for values in c.execute(stmt).tuples():
            rk=tuple(values[:len(re)])
            ck=tuple(values[len(re):len(re)+len(ce)])
            cells.append((row_keys.index(rk),col_keys.index(ck),values[-1],
                filters+[{"field":k,"op":"exact","value":v} for k,v in zip(row_fields+col_fields,rk+ck)]))
    return row_keys,col_keys,cells,total,unique

def applications(engine,owner,run_id,filters,app_ids,page,page_size):
    seg=records.alias("s")
    scope=[seg.c.run_id==run_id,seg.c.owner==owner,seg.c.section=="segments"]
    if filters:
        matched=member_query(owner,run_id,filters).cte('matching_applications')
        matched=matched.prefix_with('MATERIALIZED',dialect='postgresql')
        scope.append(seg.c.app_id.in_(select(matched.c.app_id)))
    if app_ids is not None:
        scope.append(seg.c.app_id.in_(app_ids))
    with engine.connect() as c:
        total=c.execute(select(func.count()).select_from(seg).where(*scope)).scalar_one()
        rows=list(c.execute(select(seg.c.payload).where(*scope).order_by(seg.c.app_id).offset((page-1)*page_size).limit(page_size)).scalars())
        ids=[s["APP_ID"] for s in rows]
        counts=dict(c.execute(select(records.c.app_id,func.count()).where(records.c.run_id==run_id,
            records.c.owner==owner,records.c.section=="rows",records.c.diff_flag==1,records.c.app_id.in_(ids)).group_by(records.c.app_id)).tuples().all())
    return {"items":[{**{k:s[k] for k in ("APP_ID","DECISION_BEFORE","DECISION_AFTER","DECISION_CHANGED")},
                       "changedAttributes":counts.get(s["APP_ID"],0)} for s in rows],
            "total":total,"page":page,"pageSize":page_size}

def matching_attributes(engine,owner,run_id,app_id,filters):
    with engine.connect() as c:
        return set(c.execute(select(records.c.path,records.c.array_key).join(fact_members,and_(
            records.c.run_id==fact_members.c.run_id,records.c.owner==fact_members.c.owner,
            records.c.ordinal==fact_members.c.fact_ordinal)).where(*fact_scope(owner,run_id,filters),
            fact_members.c.app_id==app_id).distinct()).tuples())

def segment(engine,owner,run_id,app_id):
    with engine.connect() as c:
        return c.execute(select(records.c.payload).where(records.c.run_id==run_id,records.c.owner==owner,
            records.c.section=="segments",records.c.app_id==app_id)).scalar_one_or_none()
