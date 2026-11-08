"""Public-access regressions: persistent atomic limits and safe defaults."""
from concurrent.futures import ThreadPoolExecutor
import os
import sqlite3
import uuid
import httpx
import pytest
from fastapi.testclient import TestClient
from backend.store import Store
from backend.api import create_app
from backend.security import reserve, used, LimitExceeded, queue_job, validate_runtime
from backend.ai import review
from backend.backup import create, verify, restore


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv('EXECUTION_MODE', 'docker')
    monkeypatch.setenv('PUBLIC_MODE', 'false')
    monkeypatch.setenv('ALLOW_REGISTRATION', 'false')
    return Store('sqlite:///' + str(tmp_path / 'security.db'))


def test_registration_flow_and_safe_defaults(db, monkeypatch):
    with TestClient(create_app(db)) as c:
        assert not c.get('/api/v1/auth/options').json()['registrationEnabled']
        assert c.post('/api/v1/auth/register', json={'username': 'tester', 'password': 'long-passphrase-test'}).status_code == 403
    monkeypatch.setenv('ALLOW_REGISTRATION', 'true')
    with TestClient(create_app(db)) as c:
        assert c.post('/api/v1/auth/register', json={'username': 'tester', 'password': 'short'}).status_code == 422
        body = {'username': 'Tester', 'password': 'long-passphrase-test'}
        assert c.post('/api/v1/auth/register', json=body).status_code == 201
        body['username'] = 'tester'
        assert c.post('/api/v1/auth/register', json=body).status_code == 409
        assert c.post('/api/v1/auth/login', json=body).status_code == 200
        limits = c.get('/api/v1/limits').json()
        assert limits['aiRequestsUsed'] == 0 and limits['resetTimezone'] == 'UTC'
        assert c.get('/api/v1/configurations').json()['total'] == 0
    monkeypatch.setenv('ALLOW_REGISTRATION', 'false')
    monkeypatch.setenv('EXECUTION_MODE', 'trusted-local')
    with pytest.raises(RuntimeError, match='requires Docker'):
        create_app(db)


def test_runtime_requires_public_prerequisites(db, monkeypatch):
    monkeypatch.setenv('ALLOW_REGISTRATION', 'true')
    monkeypatch.setenv('EXECUTION_MODE', 'trusted-local')
    with pytest.raises(RuntimeError):
        validate_runtime(db)
    monkeypatch.setenv('ALLOW_REGISTRATION', 'false')
    monkeypatch.setenv('EXECUTION_MODE', 'docker')
    monkeypatch.setenv('PUBLIC_MODE', 'true')
    monkeypatch.setenv('APP_PUBLIC_URL', 'https://example.test')
    monkeypatch.setenv('COOKIE_SECURE', 'true')
    monkeypatch.setenv('ALLOWED_ORIGINS', 'https://example.test')
    with pytest.raises(RuntimeError, match='PostgreSQL'):
        validate_runtime(db)


def test_rate_limit_persists_and_ignores_spoofed_forwarded_header(db, monkeypatch):
    monkeypatch.setenv('API_REQUESTS_PER_MINUTE', '2')
    with TestClient(create_app(db)) as c:
        assert c.get('/api/v1/health').status_code == 200
        r = c.get('/api/v1/health')
        assert r.headers['x-content-type-options'] == 'nosniff'
        assert "frame-ancestors 'none'" in r.headers['content-security-policy']
    with TestClient(create_app(db)) as c:
        r = c.get('/api/v1/health', headers={'X-Forwarded-For': 'different-ip'})
        assert r.status_code == 429 and int(r.headers['retry-after']) > 0


def test_request_body_cap_checks_stream_without_length(db, monkeypatch):
    monkeypatch.setenv('MAX_REQUEST_BYTES', '20')
    with TestClient(create_app(db)) as c:
        assert c.post('/api/v1/auth/login', content=b'x' * 21).status_code == 413
        assert c.post('/api/v1/auth/login', content=iter([b'x' * 10, b'y' * 11])).status_code == 413


@pytest.mark.parametrize('postgres', [False, True])
def test_atomic_quota_concurrency_and_transaction_rollback(db, postgres):
    if postgres:
        if not os.environ.get('TEST_POSTGRES_URL'):
            pytest.skip('PostgreSQL integration runs in CI')
        db = Store(os.environ['TEST_POSTGRES_URL'])
    scope = 'test/' + uuid.uuid4().hex
    def charge(_):
        try:
            reserve(db.engine, [(scope, 86400, 1, 5)])
            return True
        except LimitExceeded:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(charge, range(12))) == 5
    assert used(db.engine, scope) == 5
    with pytest.raises(LimitExceeded):
        reserve(db.engine, [(scope + '/first', 86400, 1, 10), (scope, 86400, 1, 5)])
    assert used(db.engine, scope + '/first') == 0
    with pytest.raises(LimitExceeded):
        reserve(db.engine, [(scope + '/disabled', 86400, 1, 0)])


def test_queue_limit_has_no_orphan_runs(db, monkeypatch):
    monkeypatch.setenv('MAX_PENDING_JOBS', '1')
    def submit(i):
        try:
            queue_job(db, {'id': f'job-{i}', 'owner': 'owner', 'status': 'QUEUED'}, run={'id': f'run-{i}'})
            return True
        except LimitExceeded:
            return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert sum(pool.map(submit, range(8))) == 1
    assert len(db.all('run', 'owner')) == 1


def test_ai_limits_reserve_refund_and_do_not_call_when_exhausted(db, monkeypatch):
    monkeypatch.setenv('AI_API_KEY', 'fake-key')
    monkeypatch.setenv('AI_MODEL', 'fake-model')
    monkeypatch.setenv('AI_API_URL', 'https://example.test/completions')
    monkeypatch.setenv('AI_PROVIDER', 'openai-compatible')
    monkeypatch.setenv('AI_REQUESTS_GLOBAL_DAY', '1')
    calls = []
    def post(url, **kwargs):
        calls.append(kwargs)
        return httpx.Response(200, json={'choices': [{'message': {'content': 'ok'}}], 'usage': {'total_tokens': 100}}, request=httpx.Request('POST', url))
    monkeypatch.setattr(httpx, 'post', post)
    assert review({}, [], db, 'alice')['status'] == 'READY'
    assert used(db.engine, 'ai.tokens.user/alice') == 100
    assert used(db.engine, 'ai.tokens.global') == 100
    assert calls[0]['json']['max_tokens'] == 1500
    assert review({}, [], db, 'bob')['status'] == 'UNAVAILABLE'
    assert len(calls) == 1
    assert used(db.engine, 'ai.tokens.user/bob') == 0


def test_ai_failure_keeps_reservation_and_never_leaks_key(db, monkeypatch):
    for key, value in {'AI_API_KEY': 'fake-secret', 'AI_MODEL': 'fake', 'AI_API_URL': 'https://example.test', 'AI_PROVIDER': 'openai-compatible'}.items():
        monkeypatch.setenv(key, value)
    def post(*args, **kwargs):
        raise httpx.ReadTimeout('fake-secret')
    monkeypatch.setattr(httpx, 'post', post)
    result = review({}, [], db, 'alice')
    assert result['status'] == 'FAILED' and 'fake-secret' not in str(result)
    assert used(db.engine, 'ai.requests.user/alice') == 1
    assert used(db.engine, 'ai.tokens.user/alice') > 1500


def test_public_python_never_falls_back_to_local(monkeypatch):
    from backend.executor import execute
    monkeypatch.setenv('EXECUTION_MODE', 'trusted-local')
    monkeypatch.setenv('PUBLIC_MODE', 'true')
    with pytest.raises(RuntimeError, match='requires Docker'):
        execute({'kind': 'COMPARE', 'code': 'raise Exception("must never execute")'})


@pytest.mark.parametrize('change', [{'METRIC': float('nan')}, {'CNT': 2}, {'APP_IDS': ['a', 'a']}, {'TOTAL': 2}, {'LABEL': 'x' * 2001}])
def test_check_rejects_untrusted_inconsistent_output(db, monkeypatch, change):
    from backend.service import Service
    svc = Service(db)
    row = dict(LABEL='test', ARGUMENT='', SOURCE='AFTER', RESULT='PASS', CONFIDENCE='HIGH', CNT=1, TOTAL=1, METRIC=1., APP_IDS=['a'])
    row.update(change)
    monkeypatch.setattr(svc, 'invoke', lambda *args, **kwargs: {'checkId': 'test', 'result': [row]})
    with pytest.raises(ValueError):
        svc.checks('owner', [{}], [], [{'APP_ID': 'a'}])


def test_sqlite_backup_restore_retention_and_corruption(tmp_path):
    source = tmp_path / 'original.db'
    with sqlite3.connect(source) as c:
        c.execute('PRAGMA journal_mode=WAL')
        c.execute('CREATE TABLE sample (value TEXT)')
        c.execute("INSERT INTO sample VALUES ('saved')")
        c.commit()
        backup = create(source, tmp_path / 'backups', keep=1)
    verify(backup)
    target = restore(backup, tmp_path / 'restored.db')
    with sqlite3.connect(target) as c:
        assert c.execute('SELECT value FROM sample').fetchone() == ('saved',)
    with pytest.raises(FileExistsError):
        restore(backup, target)
    newer = create(source, tmp_path / 'backups', keep=1)
    assert not backup.exists()
    with newer.open('ab') as stream:
        stream.write(b'corrupt')
    with pytest.raises(ValueError, match='checksum'):
        verify(newer)
