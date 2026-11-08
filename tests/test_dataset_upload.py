"""Uploaded data survives API/worker restarts and follows account ownership."""
import io
import json
import os
import secrets
import zipfile
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from backend import dataset_upload
from backend.api import create_app, password_hash
from backend.service import Service
from backend.store import Store, uid
from backend.security import LimitExceeded


def archive(files=None, folders=('BEFORE', 'AFTER')):
    if files is None:
        files = {}
        for side, folder in zip(('BEFORE', 'AFTER'), folders):
            for app_id in ('new-a', 'new-b'):
                decision = 'REJECT' if side == 'AFTER' and app_id == 'new-a' else 'APPROVE'
                files[f'example/{folder}/{app_id}.json'] = json.dumps({
                    'appData': {'application_id': app_id}, 'decisionResult': {'decision': decision}}, ensure_ascii=False)
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, body in files.items():
            z.writestr(name, body)
    return output.getvalue()


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv('EXECUTION_MODE', 'trusted-local')
    monkeypatch.setenv('PUBLIC_MODE', 'false')
    monkeypatch.setenv('ALLOW_REGISTRATION', 'false')
    db = Store(os.environ.get('TEST_POSTGRES_URL') or 'sqlite:///' + str(tmp_path / 'upload.db'))
    def client():
        owner, salt = uid(), secrets.token_hex(16)
        db.put('user', 'system', dict(id=owner, username=owner, salt=salt, passwordHash=password_hash('test-password', salt)))
        c = TestClient(create_app(db))
        login = c.post('/api/v1/auth/login', json={'username': owner, 'password': 'test-password'})
        assert login.status_code == 200
        c.headers['X-CSRF-Token'] = login.json()['csrfToken']
        return c, owner
    return db, client


def upload(client, content=None, name='Мой датасет'):
    return client.post('/api/v1/datasets', params={'name': name}, content=archive() if content is None else content,
                       headers={'Content-Type': 'application/zip'})


def configuration(dataset_id):
    return dict(name='Uploaded strategy', datasetId=dataset_id,
        normalizer={'scriptId': 'builtin-normalize', 'params': {}},
        comparator={'scriptId': 'builtin-compare', 'params': {}},
        aggregator={'scriptId': 'builtin-aggregate', 'params': {}}, checks=[], aiReviewEnabled=False)


def test_uploaded_dataset_real_pipeline_persistence_and_account_isolation(setup):
    db, make_client = setup
    c, owner = make_client()
    other, other_owner = make_client()
    result = upload(c)
    assert result.status_code == 201, result.text
    dataset = result.json()
    assert dataset['appCount'] == 2 and dataset['kind'] == 'CUSTOM' and dataset['status'] == 'READY'
    assert 'document' not in result.text
    assert dataset in c.get('/api/v1/datasets').json()['items']
    assert dataset not in other.get('/api/v1/datasets').json()['items']
    assert other.post('/api/v1/configurations', json=configuration(dataset['id'])).status_code == 422
    assert other.post('/api/v1/script-executions', json={
        'scriptId': 'builtin-normalize', 'datasetId': dataset['id']}).status_code == 422
    with pytest.raises(ValueError):
        Service(Store(db.engine.url)).load_dataset(other_owner, dataset['id'])

    # The API and worker open independent database connections, as in Compose.
    fresh = Store(db.engine.url)
    restarted = TestClient(create_app(fresh))
    restarted.cookies.update(c.cookies)
    restarted.headers['X-CSRF-Token'] = c.headers['X-CSRF-Token']
    assert dataset in restarted.get('/api/v1/datasets').json()['items']
    config = restarted.post('/api/v1/configurations', json=configuration(dataset['id']))
    assert config.status_code == 201, config.text
    run_id = restarted.post('/api/v1/runs', json={'configurationId': config.json()['id']}).json()['id']
    worker = Service(Store(db.engine.url))
    for job in worker.store.all('job', owner):
        if job['status'] == 'QUEUED':
            worker.process_job(job)
    base = '/api/v1/runs/' + run_id
    assert restarted.get(base).json()['status'] == 'SUCCEEDED'
    summary = restarted.get(base + '/summary').json()
    assert (summary['totalApps'], summary['changedApps'], summary['decisionChangedApps']) == (2, 1, 1)
    assert restarted.get(base + '/applications/new-a/raw?source=AFTER').json()['document']['decisionResult']['decision'] == 'REJECT'
    assert other.get(base + '/summary').status_code == 404

    preview = restarted.post('/api/v1/script-executions', json={'scriptId': 'builtin-normalize', 'datasetId': dataset['id']})
    assert preview.status_code == 202
    for job in worker.store.all('job', owner):
        if job['status'] == 'QUEUED':
            worker.process_job(job)
    assert restarted.get('/api/v1/script-executions/' + preview.json()['executionId']).json()['status'] == 'SUCCEEDED'


def test_upload_requires_session_and_csrf(setup):
    db, make_client = setup
    with TestClient(create_app(db)) as anonymous:
        assert upload(anonymous).status_code == 401
    c, _ = make_client()
    del c.headers['X-CSRF-Token']
    assert upload(c).status_code == 403


@pytest.mark.parametrize('content', [
    b'not a zip', archive({}),
    archive({'BEFORE/a.json': '{invalid'}),
    archive({'BEFORE/a.json': '{"appData":{"application_id":"wrong"}}'}),
    archive({'BEFORE/a.json': '{"appData":{"application_id":"a"}}'}),
    archive({'../BEFORE/a.json': '{}'}),
    archive({'/BEFORE/a.json': '{}'}),
    archive({'BEFORE\\a.json': '{}'}),
    archive({'other/a.json': '{}'}),
    archive({'BEFORE/a.json': '{"appData":{"application_id":"a"},"x":NaN}'}),
    archive({'BEFORE/a.json': '{"appData":{"application_id":"a"},"x":1e999}'}),
    archive({'BEFORE/a.json': '{"appData":{"application_id":"a"},"x":0,"x":1}'}),
    archive({'BEFORE/a.json': '{"appData":{"application_id":"a"},"x":"\\ud800"}'}),
])
def test_invalid_archive_never_publishes_partial_dataset(setup, content):
    db, make_client = setup
    c, owner = make_client()
    response = upload(c, content)
    assert response.status_code == 422, response.text
    assert response.json()['error']['code'] == 'INVALID_DATASET'
    assert db.all('dataset', owner) == []


def test_archive_aliases_bom_and_public_personal_access(setup, monkeypatch):
    db, make_client = setup
    c, owner = make_client()
    result = upload(c, archive(folders=('BEFORE_MASTER', 'AFTER_BETA')))
    assert result.status_code == 201
    # Public mode only filters shared datasets, not this account's private uploads.
    monkeypatch.setenv('PUBLIC_MODE', 'true')
    monkeypatch.setenv('PUBLIC_DATASET_IDS', '')
    assert [d['id'] for d in c.get('/api/v1/datasets').json()['items']] == [result.json()['id']]
    assert c.post('/api/v1/configurations', json=configuration(result.json()['id'])).status_code == 201
    doc = '\ufeff' + json.dumps({'appData': {'application_id': 'bom'}})
    assert len(dataset_upload.parse_archive(archive({'BEFORE/bom.json': doc, 'AFTER/bom.json': doc}))[0]) == 1


def test_archive_rejects_symlinks_duplicate_sides_and_mixed_roots():
    doc = json.dumps({'appData': {'application_id': 'a'}})
    with pytest.raises(dataset_upload.UploadError, match='Повторяется'):
        dataset_upload.parse_archive(archive({'BEFORE/a.json': doc, 'BEFORE_MASTER/a.json': doc, 'AFTER/a.json': doc}))
    with pytest.raises(dataset_upload.UploadError, match='один датасет'):
        dataset_upload.parse_archive(archive({'x/BEFORE/a.json': doc, 'y/AFTER/a.json': doc}))
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as z:
        entry = zipfile.ZipInfo('BEFORE/a.json')
        entry.external_attr = 0o120777 << 16
        z.writestr(entry, 'target')
    with pytest.raises(dataset_upload.UploadError, match='символическую ссылку'):
        dataset_upload.parse_archive(output.getvalue())


def test_upload_bounds_streamed_body_expansion_pairs_and_storage(setup, monkeypatch):
    db, make_client = setup
    c, owner = make_client()
    monkeypatch.setenv('MAX_DATASET_ARCHIVE_BYTES', '20')
    assert c.get('/api/v1/datasets/upload-options').json()['maxArchiveBytes'] == 20
    assert upload(c).status_code == 413
    assert upload(c, iter([b'x' * 10, b'x' * 11])).status_code == 413
    monkeypatch.delenv('MAX_DATASET_ARCHIVE_BYTES')
    monkeypatch.setenv('MAX_DATASET_EXPANDED_BYTES', '20')
    assert upload(c).status_code == 422
    monkeypatch.delenv('MAX_DATASET_EXPANDED_BYTES')
    monkeypatch.setenv('MAX_DATASET_PAIRS', '1')
    assert upload(c).status_code == 422
    monkeypatch.delenv('MAX_DATASET_PAIRS')
    monkeypatch.setenv('MAX_DATASET_STORAGE_BYTES', '1')
    assert upload(c).status_code == 429
    assert db.all('dataset', owner) == []


def test_concurrent_dataset_admission_is_atomic(setup, monkeypatch):
    db, make_client = setup
    _, owner = make_client()
    pairs, size = dataset_upload.parse_archive(archive())
    monkeypatch.setenv('MAX_DATASETS_PER_USER', '1')
    def save(_):
        try:
            db.save_dataset(owner, dict(id='custom-' + uid(), sizeBytes=size), pairs)
            return True
        except LimitExceeded:
            return False
    with ThreadPoolExecutor(max_workers=3) as pool:
        assert sum(pool.map(save, range(3))) == 1
    assert len(db.all('dataset', owner)) == 1
