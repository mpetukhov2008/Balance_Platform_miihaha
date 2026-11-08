"""Regression coverage for the final security review."""
import asyncio
import hashlib
import time

import pytest
from backend.http_security import SecurityMiddleware
from backend.store import Store
from backend.executor import execute
from backend.security import csrf_matches


@pytest.mark.parametrize('case,status', [('anonymous',401), ('expired',401), ('csrf',403), ('origin',403), ('busy',429)])
def test_reject_upload_before_consuming_body(tmp_path, monkeypatch, case, status):
    monkeypatch.setenv('PUBLIC_MODE','false')
    db=Store('sqlite:///'+str(tmp_path/'early.db'))
    token='test-cookie'
    if case!='anonymous':
        db.put('session','test-user',dict(id=hashlib.sha256(token.encode()).hexdigest(),
            user={'id':'test-user'},csrfToken='csrf',expires=time.time()+(-1 if case=='expired' else 60)))
    async def downstream(scope, receive, send):
        raise AssertionError('Unauthorised/over-capacity upload reached application')
    middleware=SecurityMiddleware(downstream,db)
    async def check():
        if case=='busy':
            await middleware.upload_slots.acquire()
            await middleware.upload_slots.acquire()
        headers=[(b'cookie',b'balance_session=test-cookie'),(b'x-csrf-token',b'wrong' if case=='csrf' else b'csrf')]
        if case=='origin': headers.append((b'origin',b'https://attacker.invalid'))
        scope=dict(type='http',method='POST',path='/api/v1/datasets',headers=headers,client=('test',1))
        messages=[]
        async def receive():
            raise AssertionError('Request body was consumed before access checks')
        async def send(message): messages.append(message)
        await middleware(scope,receive,send)
        assert messages[0]['status']==status
    asyncio.run(check())


def test_malformed_csrf_rejects_without_server_error():
    assert not csrf_matches('é','normal-ascii-token')
    assert not csrf_matches('','normal-ascii-token')
    assert csrf_matches('normal-ascii-token','normal-ascii-token')


def test_local_executor_does_not_inherit_server_secrets(monkeypatch):
    monkeypatch.setenv('EXECUTION_MODE','trusted-local')
    monkeypatch.setenv('PUBLIC_MODE','false')
    monkeypatch.setenv('ALLOW_REGISTRATION','false')
    monkeypatch.setenv('AI_API_KEY','test-only-secret')
    monkeypatch.setenv('DATABASE_URL','test-only-database')
    result=execute(dict(kind='COMPARE',rows=[],params={},code="import os\ndef run(rows, params):\n    assert 'AI_API_KEY' not in os.environ\n    assert 'DATABASE_URL' not in os.environ\n    return []\n"))
    assert result['result']==[]
