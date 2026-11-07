import asyncio
import time
from starlette.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from backend.security import LimitExceeded, reserve, number, enabled, registration_enabled


class SecurityMiddleware:
    def __init__(self, app, store):
        self.app, self.store = app, store

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)

        async def secured_send(message):
            if message['type'] == 'http.response.start':
                headers = list(message.get('headers', []))
                headers += [(b'x-content-type-options', b'nosniff'), (b'x-frame-options', b'DENY'),
                    (b'referrer-policy', b'same-origin'),
                    (b'permissions-policy', b'camera=(), microphone=(), geolocation=()'),
                    (b'content-security-policy', b"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")]
                # Local Swagger/ReDoc load official framework CDN assets. Public mode disables these pages.
                if not enabled('PUBLIC_MODE') and scope['path'] in ('/docs', '/docs/oauth2-redirect', '/redoc'):
                    headers = [(k, v) for k, v in headers if k != b'content-security-policy']
                if scope['path'].startswith('/api/') or not scope['path'].startswith('/assets/'):
                    headers.append((b'cache-control', b'no-store'))
                if enabled('PUBLIC_MODE'):
                    headers.append((b'strict-transport-security', b'max-age=31536000'))
                message = {**message, 'headers': headers}
            await send(message)

        async def reject(status, code, message, headers=None):
            await JSONResponse({'error': {'code': code, 'message': message}}, status_code=status,
                               headers=headers)(scope, receive, secured_send)

        if scope['path'].startswith('/api/v1/'):
            ip = (scope.get('client') or ('unknown', 0))[0]
            charges = [('http.ip/' + ip, 60, 1, number('API_REQUESTS_PER_MINUTE', 600))]
            if scope['method'] == 'POST' and scope['path'] == '/api/v1/auth/login':
                charges += [('login.ip/' + ip, 900, 1, number('LOGIN_ATTEMPTS_PER_15_MIN', 20)),
                            ('login.global', 60, 1, number('LOGIN_ATTEMPTS_GLOBAL_PER_MIN', 60))]
            if scope['method'] == 'POST' and scope['path'] == '/api/v1/auth/register' and registration_enabled():
                charges += [('register.ip/' + ip, 3600, 1, number('REGISTRATIONS_PER_IP_HOUR', 3)),
                            ('register.global', 86400, 1, number('REGISTRATIONS_PER_DAY', 100))]
            try:
                await run_in_threadpool(reserve, self.store.engine, charges)
            except LimitExceeded as error:
                return await reject(429, 'RATE_LIMIT', str(error), {'Retry-After': str(error.retry_after)})

        if scope['method'] in ('POST', 'PATCH', 'PUT'):
            cap = number('MAX_REQUEST_BYTES', 1048576)
            content_length = next((v for k, v in scope.get('headers', []) if k == b'content-length'), None)
            if content_length is not None:
                try:
                    if int(content_length) > cap:
                        return await reject(413, 'BODY_TOO_LARGE', 'Слишком большой запрос.')
                except ValueError:
                    return await reject(400, 'INVALID_LENGTH', 'Неверная длина запроса.')
            messages, size = [], 0
            deadline = time.monotonic() + 15
            while True:
                try:
                    message = await asyncio.wait_for(receive(), max(.01, deadline - time.monotonic()))
                except asyncio.TimeoutError:
                    return await reject(408, 'BODY_TIMEOUT', 'Истекло время загрузки запроса.')
                if message['type'] == 'http.disconnect':
                    return
                size += len(message.get('body', b''))
                if size > cap:
                    return await reject(413, 'BODY_TOO_LARGE', 'Слишком большой запрос.')
                messages.append(message)
                if not message.get('more_body', False):
                    break
            cursor = iter(messages)
            original_receive = receive

            async def replay():
                try:
                    return next(cursor)
                except StopIteration:
                    return await original_receive()
            receive = replay
        await self.app(scope, receive, secured_send)
