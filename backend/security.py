"""Persistent quotas and explicit public-server configuration checks."""
import hashlib
import hmac
import os
import time
from urllib.parse import urlparse

from sqlalchemy import Table, Column, String, BigInteger, Float, select, update, case
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from backend.store import metadata, objects

quotas = Table('security_quotas', metadata, Column('id', String(100), primary_key=True),
               Column('used', BigInteger, nullable=False), Column('expires', Float, nullable=False))
locks = Table('security_locks', metadata, Column('id', String(50), primary_key=True),
              Column('value', BigInteger, nullable=False))


class LimitExceeded(Exception):
    def __init__(self, message='Лимит запросов исчерпан. Попробуйте позже.', retry_after=60):
        super().__init__(message)
        self.retry_after = max(1, int(retry_after))


def number(name, default):
    value = int(os.environ.get(name, default))
    if value < 0:
        raise ValueError(name + ' must be nonnegative')
    return value


def enabled(name):
    return os.environ.get(name, '').lower() == 'true'


def registration_enabled():
    return enabled('ALLOW_REGISTRATION') and os.environ.get('EXECUTION_MODE', 'docker') == 'docker'


def session_for_token(store, token):
    item = store.get('session', None, hashlib.sha256(token.encode('utf-8')).hexdigest()) if token else None
    return item if item and item['expires'] >= time.time() else None


def csrf_matches(candidate, expected):
    return hmac.compare_digest(candidate.encode('utf-8'), expected.encode('utf-8'))


def origin_allowed(origin):
    allowed = {value.strip() for value in os.environ.get('ALLOWED_ORIGINS', 'http://localhost:8000,http://localhost:5173').split(',')}
    return origin is None or origin in allowed


def validate_runtime(store):
    mode = os.environ.get('EXECUTION_MODE', 'docker')
    policy = store.get('policy', 'system', 'deployment-security')
    if policy and policy.get('dockerRequired') and mode != 'docker':
        raise RuntimeError('This database has self-service users and requires Docker execution')
    if enabled('ALLOW_REGISTRATION') and mode != 'docker':
        raise RuntimeError('Registration requires EXECUTION_MODE=docker')
    if enabled('PUBLIC_MODE'):
        origin = os.environ.get('APP_PUBLIC_URL', '')
        parsed = urlparse(origin)
        allowed = os.environ.get('ALLOWED_ORIGINS', '').split(',')
        if mode != 'docker' or not enabled('COOKIE_SECURE') or parsed.scheme != 'https' or not parsed.netloc:
            raise RuntimeError('PUBLIC_MODE requires Docker, HTTPS APP_PUBLIC_URL and COOKIE_SECURE=true')
        if parsed.path not in ('', '/') or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise RuntimeError('APP_PUBLIC_URL must be an HTTPS origin')
        if origin.rstrip('/') not in allowed or any(urlparse(x).scheme != 'https' or '*' in x for x in allowed):
            raise RuntimeError('PUBLIC_MODE requires an explicit HTTPS ALLOWED_ORIGINS list')
        if store.engine.dialect.name != 'postgresql':
            raise RuntimeError('PUBLIC_MODE requires PostgreSQL')
    if enabled('ALLOW_REGISTRATION') or enabled('PUBLIC_MODE'):
        store.put('policy', 'system', {'id': 'deployment-security', 'dockerRequired': True})


def insert_ignore(connection, table, values):
    factory = postgres_insert if connection.dialect.name == 'postgresql' else sqlite_insert
    connection.execute(factory(table).values(**values).on_conflict_do_nothing())


def bucket(scope, seconds, at=None):
    at = time.time() if at is None else at
    window = int(at // seconds)
    return hashlib.sha256(scope.encode()).hexdigest() + ':' + str(window), (window + 1) * seconds


def reserve(engine, charges):
    """All counters are charged atomically, including concurrent processes."""
    receipts = []
    at = time.time()
    with engine.begin() as c:
        for scope, seconds, amount, limit in charges:
            key, expires = bucket(scope, seconds, at)
            insert_ignore(c, quotas, dict(id=key, used=0, expires=expires))
            result = c.execute(update(quotas).where(quotas.c.id == key, quotas.c.used <= limit - amount)
                               .values(used=quotas.c.used + amount))
            if result.rowcount != 1:
                raise LimitExceeded(retry_after=expires - at)
            receipts.append((key, amount))
    return receipts


def refund(engine, receipts, amount):
    if amount <= 0:
        return
    with engine.begin() as c:
        for key, reserved in receipts:
            delta = min(amount, reserved)
            c.execute(update(quotas).where(quotas.c.id == key).values(
                used=case((quotas.c.used >= delta, quotas.c.used - delta), else_=0)))


def used(engine, scope, seconds=86400):
    key, _ = bucket(scope, seconds)
    with engine.connect() as c:
        return c.execute(select(quotas.c.used).where(quotas.c.id == key)).scalar() or 0


def queue_job(store, item, run=None, log=None):
    """Serialize admission, not execution; API replicas cannot overfill the queue."""
    from sqlalchemy import func
    with store.engine.begin() as c:
        insert_ignore(c, locks, dict(id='admission', value=0))
        c.execute(update(locks).where(locks.c.id == 'admission').values(value=locks.c.value + 1))
        pending = [objects.c.kind == 'job', objects.c.data['status'].as_string().in_(['QUEUED', 'RUNNING'])]
        total = c.execute(select(func.count()).select_from(objects).where(*pending)).scalar_one()
        own = c.execute(select(func.count()).select_from(objects).where(*pending, objects.c.owner == item['owner'])).scalar_one()
        if total >= number('MAX_PENDING_JOBS', 50) or own >= number('MAX_PENDING_JOBS_PER_USER', 2):
            raise LimitExceeded('Очередь заполнена. Дождитесь завершения текущих задач.', 10)
        if run:
            retained = c.execute(select(func.count()).select_from(objects).where(
                objects.c.kind == 'run', objects.c.owner == item['owner'])).scalar_one()
            if retained >= number('MAX_RUNS_PER_USER', 10):
                raise LimitExceeded('Достигнут лимит сохранённых запусков. Обратитесь к администратору.', 3600)
        for kind, value in [('job', item), ('run', run), ('logs', log)]:
            if value is not None:
                c.execute(objects.insert().values(id=value['id'], kind=kind, owner=item['owner'], data=value))
