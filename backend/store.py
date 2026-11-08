import os
import uuid
import time
from datetime import datetime, timezone
from sqlalchemy import create_engine, event, MetaData, Table, Column, String, Integer, JSON, Index, select, update, delete

def now():
    return datetime.now(timezone.utc).isoformat()

def uid():
    return uuid.uuid4().hex

metadata = MetaData()
objects = Table("objects", metadata,
    Column("id", String(128), primary_key=True), Column("kind", String(32), primary_key=True),
    Column("owner", String(128), index=True, nullable=False), Column("data", JSON, nullable=False))
records = Table("records", metadata,
    Column("run_id", String(128), primary_key=True), Column("section", String(32), primary_key=True),
    Column("ordinal", Integer, primary_key=True), Column("owner", String(128), nullable=False),
    Column("app_id", String(128)), Column("path", String(1000)), Column("array_key", String(1000)),
    Column("diff_flag", Integer), Column("change_type", String(32)), Column("payload", JSON, nullable=False))
Index("ix_attribute_lookup", records.c.run_id, records.c.section, records.c.app_id, records.c.path)
Index("ix_changes", records.c.run_id, records.c.section, records.c.diff_flag, records.c.change_type)
fact_members = Table("fact_members", metadata,
    Column("run_id",String(128),primary_key=True), Column("owner",String(128),nullable=False),
    Column("fact_ordinal",Integer,primary_key=True),Column("app_id",String(128),primary_key=True))
Index("ix_member_app",fact_members.c.run_id,fact_members.c.owner,fact_members.c.app_id)
Index("ix_member_cover",fact_members.c.run_id,fact_members.c.owner,fact_members.c.app_id,fact_members.c.fact_ordinal)
Index("ix_member_fact",fact_members.c.run_id,fact_members.c.owner,fact_members.c.fact_ordinal,fact_members.c.app_id)

class Store:
    def __init__(self, url=None):
        from backend.security import quotas, locks
        self.engine = create_engine(url or os.environ.get("DATABASE_URL", "sqlite:///runtime/balance.db"))
        if self.engine.dialect.name == "sqlite":
            @event.listens_for(self.engine, "connect")
            def configure_sqlite(connection, _):
                connection.execute("PRAGMA busy_timeout=30000")
                connection.execute("PRAGMA journal_mode=WAL")
        metadata.create_all(self.engine)
        with self.engine.begin() as c:
            c.execute(delete(quotas).where(quotas.c.expires < time.time()))
        # Additive schema upgrade for pre-existing v0.1 databases.
        for idx in fact_members.indexes:
            idx.create(self.engine,checkfirst=True)

    def put_many(self, kind, owner, items):
        """Insert new immutable objects in one transaction (e.g. pivot tokens)."""
        if items:
            with self.engine.begin() as c:
                c.execute(objects.insert(), [{"id": item["id"], "kind": kind, "owner": owner, "data": item} for item in items])

    def save_dataset(self, owner, item, pairs):
        """Publish metadata and documents atomically, shared by API and worker."""
        from backend.security import insert_ignore, locks, number, LimitExceeded
        with self.engine.begin() as c:
            insert_ignore(c, locks, dict(id='dataset-admission', value=0))
            c.execute(update(locks).where(locks.c.id == 'dataset-admission').values(value=locks.c.value + 1))
            existing = list(c.execute(select(objects.c.data).where(objects.c.kind == 'dataset', objects.c.owner == owner)).scalars())
            if len(existing) >= number('MAX_DATASETS_PER_USER', 5):
                raise LimitExceeded('Достигнут лимит сохранённых датасетов. Обратитесь к администратору.', 3600)
            if sum(d['sizeBytes'] for d in existing) + item['sizeBytes'] > number('MAX_DATASET_STORAGE_BYTES', 256 * 1024 * 1024):
                raise LimitExceeded('Недостаточно места для датасета в вашем аккаунте.', 3600)
            c.execute(objects.insert().values(id=item['id'], kind='dataset', owner=owner, data=item))
            batch = []
            for app_id, pair in sorted(pairs.items()):
                for side, doc in pair.items():
                    batch.append(dict(run_id=item['id'], section='dataset', ordinal=len(batch), owner=owner,
                                      app_id=app_id, payload={'APP_ID': app_id, 'SOURCE': side, 'document': doc}))
            for start in range(0, len(batch), 500):
                c.execute(records.insert(), batch[start:start + 500])
        return item

    def load_dataset(self, owner, id):
        if self.get('dataset', owner, id) is None:
            raise ValueError('Датасет недоступен')
        with self.engine.connect() as c:
            rows = c.execute(select(records.c.payload).where(records.c.run_id == id,
                records.c.section == 'dataset', records.c.owner == owner).order_by(records.c.ordinal)).scalars()
            pairs = {}
            for row in rows:
                pairs.setdefault(row['APP_ID'], {})[row['SOURCE']] = row['document']
            return pairs

    def put(self, kind, owner, data):
        analyze_facts = kind == 'result' and 'facts' in data and self.engine.dialect.name == 'postgresql'
        with self.engine.begin() as c:
            if kind == "result":
                # Publish all sections and metadata in one transaction.
                for section in ("rows", "segments", "facts", "checks", "raw"):
                    if section not in data:
                        continue
                    c.execute(delete(records).where(records.c.run_id == data["id"], records.c.owner == owner,records.c.section==section))
                    items = [{"run_id": data["id"], "section": section, "ordinal": i, "owner": owner,
                        "app_id": r.get("APP_ID"), "path": r.get("PATH"), "array_key": r.get("ARRAY_KEY"),
                        "diff_flag": r.get("DIFF_FLAG"), "change_type": r.get("CHANGE_TYPE"), "payload": r}
                        for i,r in enumerate(data[section])]
                    for start in range(0,len(items),500):
                        c.execute(records.insert(),items[start:start+500])
                    if section == "facts":
                        c.execute(delete(fact_members).where(fact_members.c.run_id==data["id"],fact_members.c.owner==owner))
                        batch=[]
                        for i,fact in enumerate(data[section]):
                            for app_id in set(fact["APP_IDS"]):
                                batch.append(dict(run_id=data["id"],owner=owner,fact_ordinal=i,app_id=app_id))
                                if len(batch)>=1000:
                                    c.execute(fact_members.insert(),batch)
                                    batch=[]
                        if batch:
                            c.execute(fact_members.insert(),batch)
                data = {k:v for k,v in data.items() if k not in ("rows","segments","facts","checks","raw")}
            elif kind == "artifact" and data["id"].startswith("normalized-"):
                run_id = data["id"]
                c.execute(delete(records).where(records.c.run_id == run_id, records.c.owner == owner))
                for start in range(0,len(data["rows"]),500):
                    c.execute(records.insert(), [{"run_id":run_id,"section":"normalized","ordinal":start+i,
                        "owner":owner,"app_id":r["APP_ID"],"path":r["PATH"],"array_key":r["ARRAY_KEY"],
                        "diff_flag":None,"change_type":None,"payload":r} for i,r in enumerate(data["rows"][start:start+500])])
                data = {"id":run_id,"rowCount":len(data["rows"])}
            found = c.execute(select(objects.c.id).where(objects.c.id == data["id"], objects.c.kind == kind)).first()
            if found:
                c.execute(update(objects).where(objects.c.id == data["id"], objects.c.kind == kind, objects.c.owner == owner).values(data=data))
            else:
                c.execute(objects.insert().values(id=data["id"], kind=kind, owner=owner, data=data))
        if analyze_facts:
            # A second, much larger report can arrive before autovacuum refreshes
            # statistics from the first. Refresh after bulk publication so the
            # next interactive query does not inherit a tiny-dataset join plan.
            with self.engine.begin() as c:
                c.exec_driver_sql('ANALYZE records')
                c.exec_driver_sql('ANALYZE fact_members')
        return data

    def get(self, kind, owner, id, sections=None):
        with self.engine.connect() as c:
            stmt = select(objects.c.data).where(objects.c.id == id, objects.c.kind == kind)
            if owner is not None:
                stmt = stmt.where(objects.c.owner == owner)
            data = c.execute(stmt).scalar_one_or_none()
            if data is not None and kind == "result":
                for section in (("rows","segments","facts","checks") if sections is None else sections):
                    data[section] = list(c.execute(select(records.c.payload).where(records.c.run_id==id,
                        records.c.section==section,records.c.owner==owner).order_by(records.c.ordinal)).scalars())
            return data

    def attributes(self, owner, run_id, app_id, path=None, array_key=None, diff_only=False):
        stmt=select(records.c.payload).where(records.c.run_id==run_id,records.c.section=="rows",
            records.c.owner==owner,records.c.app_id==app_id)
        if path is not None:
            stmt=stmt.where(records.c.path==path)
        if array_key is not None:
            stmt=stmt.where(records.c.array_key==array_key)
        if diff_only:
            stmt=stmt.where(records.c.diff_flag==1)
        with self.engine.connect() as c:
            return list(c.execute(stmt.order_by(records.c.ordinal)).scalars())

    def raw(self, owner, run_id, app_id, source):
        with self.engine.connect() as c:
            rows=c.execute(select(records.c.payload).where(records.c.run_id==run_id,records.c.owner==owner,
                records.c.section=="raw",records.c.app_id==app_id)).scalars()
            return next((r["document"] for r in rows if r["SOURCE"]==source),None)

    def all(self, kind, owner):
        with self.engine.connect() as c:
            stmt = select(objects.c.data).where(objects.c.kind == kind)
            if owner is not None:
                stmt = stmt.where(objects.c.owner == owner)
            return list(c.execute(stmt.order_by(objects.c.id)).scalars())

    def remove(self, id):
        with self.engine.begin() as c:
            c.execute(delete(objects).where(objects.c.id == id))

    def claim(self):
        # PostgreSQL SKIP LOCKED permits independent workers; SQLite is single-worker dev only.
        with self.engine.begin() as c:
            rows = c.execute(select(objects).where(objects.c.kind == "job").order_by(objects.c.id).with_for_update(skip_locked=True)).mappings()
            for row in rows:
                data = row["data"]
                if data["status"] == "QUEUED":
                    data["status"] = "RUNNING"
                    c.execute(update(objects).where(objects.c.id == row["id"], objects.c.kind == "job").values(data=data))
                    return data
        return None
