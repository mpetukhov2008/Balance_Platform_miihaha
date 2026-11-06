# Баланс Платформа — анализ изменений СПР

Серверная часть прототипа. Frontend разрабатывает Claude в `frontend/` отдельно. Начальный договор API: `handoff/claude/API_CONTRACT.md`; задания и ограничения исходных материалов — рядом. Полного `data/` пока нет. Поддерживаются четыре реальные пары из `Исходники/samples/`.

Исходные материалы остаются локальными: публикация docs/checks, samples, Excel и иллюстрации требует отдельного разрешения автоматической проверки. Для работы добавьте Исходники/ из переданного пакета. Без samples зависимые тесты пропускаются явно; независимый сквозной тест на искусственном наборе выполняется и без них.

## Быстрый запуск сервера (Python 3.12)

Команды выполняются из корня репозитория. Для Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m backend.manage create-user analyst
.\.venv\Scripts\python.exe -m backend.manage create-user analyst2
.\.venv\Scripts\python.exe -m uvicorn backend.api:app --host 127.0.0.1 --port 8000
```

Пароли вводятся интерактивно; пользователей и паролей по умолчанию нет. На Linux вместо `.venv\Scripts\python.exe` используйте `.venv/bin/python`.

По умолчанию локальные метаданные сохраняются в SQLite `runtime/balance.db`. Для полного окружения используйте PostgreSQL через Compose. SQLite — только однопроцессная очередь разработки.

Откройте `http://localhost:8000/docs`. Войдите через `/api/v1/auth/login`; для всех последующих POST/PATCH добавляйте заголовок `X-CSRF-Token` из ответа. Браузер хранит HttpOnly session-cookie. Vite должен проксировать `/api` на `http://127.0.0.1:8000`, иначе требуется дополнительная настройка CORS, которой в этом варианте нет.

В другом терминале запустите worker:

```powershell
.\.venv\Scripts\python.exe -m backend.worker
```

Worker по умолчанию выполняет процедуры в Docker-контейнерах. До первого прогона запустите Docker Desktop в режиме Linux containers и соберите образ:

```powershell
docker build -f infra/Runner.Dockerfile -t balance-runner:local .
```

Служба Docker должна быть доступна worker. API не исполняет Python-код пользователя. Если Docker отсутствует, расчёт завершается явной ошибкой, автоматического перехода к незащищённому выполнению нет.

Только для разработки с проверенным кодом допустим режим:

```powershell
$env:EXECUTION_MODE='trusted-local'
.\.venv\Scripts\python.exe -m backend.worker
```

Это обычный дочерний процесс с правами пользователя, **не песочница**. Не включать для чужого кода или сервера общего доступа. В контейнерном режиме runner без сети, без host mounts, с read-only root, отдельным пользователем, ограничениями памяти/CPU/PID и timeout. Worker с доступом к Docker daemon — привилегированная инфраструктурная часть; API-контейнер такого доступа не имеет.

## PostgreSQL и контейнеры

```powershell
Copy-Item .env.example .env
# Установите свой случайный URL-safe POSTGRES_PASSWORD в .env.
docker compose --profile tools build
docker compose up -d db api worker
docker compose exec api python -m backend.manage create-user analyst
docker compose exec api python -m backend.manage create-user analyst2
```

API доступен только на `127.0.0.1:8000`. Запускается **один worker**: в текущей версии восстановление его очереди при старте и обновления отчёта не рассчитаны на несколько worker. Перезапуск страницы безопасен: состояние хранится в БД. Если worker прерван во время выполнения, после его старта незавершённая работа помечается FAILED; нужен новый запуск, автоматического resume нет.

Docker Compose и PostgreSQL требуют отдельной проверки в работающем Docker. Наличие этих файлов само по себе не подтверждает успешный контейнерный запуск.

## Прогон

1. `GET /api/v1/datasets` — сейчас используйте `samples`.
2. `GET /api/v1/scripts` — встроенные `builtin-normalize`, `builtin-compare`, `builtin-aggregate` и пять выданных CHECK.
3. `POST /api/v1/configurations` по схеме в `/docs`. Выберите процедуры, их параметры, проверки.
4. `POST /api/v1/runs` с `configurationId`. Worker заберёт задание; API остаётся доступен.
5. Опрос `GET /runs/{id}` и `/logs`. После `reportReady=true` доступны summary, dimensions, pivot/query, applications/query, детали, check-results и report.html.
6. Для своей проверки создайте Script с `kind=CHECK`, `contractId=check-v1`, затем `POST /runs/{id}/check-executions`. Повторный запуск CHECK.id заменяет его строки в отчёте без повторной нормализации.

Все пути выше, кроме `/docs`, имеют префикс `/api/v1`. Стабильный HTML формируется на чтении из опубликованного результата; строки из данных экранируются.

## Подключение полного data

Не нужно вставлять JSON в чат. Задайте `FULL_DATA_ROOT` локальной папкой, содержащей `BEFORE_MASTER/` и `AFTER_BETA/`. В Compose задайте `DATA_DIR` такой папкой в `.env` и пересоздайте api/worker. Датасет `full` станет доступен. Имена файлов и `appData.application_id` должны совпадать; несовпадающие наборы срезов дают ошибку.

## ИИ-мнение

Опционально задайте `AI_API_URL` (полный URL OpenAI-compatible chat/completions), `AI_API_KEY`, `AI_MODEL` в окружении worker. Передаются только агрегаты и ограниченный набор названий/чисел проверок, без сырых ответов и APP_IDS. При отсутствии настроек показывается UNAVAILABLE, вычисленный отчёт остаётся доступен. Реальный внешний провайдер пока не проверен. После новой проверки старое мнение отмечается STALE.

## Тесты и известные границы

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Тесты используют отдельные временные SQLite-базы и явно включают `trusted-local`; они не подтверждают контейнерную изоляцию и работу PostgreSQL. Проверяются реальные samples, ключи массивов, null/false/0/отсутствие, бакеты, пять проверок, API-переходы, CSRF, разделение пользователей, HTML и новая проверка.

Предметная политика выбора одного продукта для скалярных PD_MODEL/CUTOFF: продукт top-offer, при отсутствии оффера — минимальный product_id в лексикографическом порядке. Это явное решение прототипа; исходники не задают единственного правила. Все продукты и их атрибуты в сравнении сохраняются. Null → false считается изменением. Источник политики и известные ограничения пяти проверок описаны в `handoff/claude/SOURCE_FINDINGS.md`.

Нормализованные строки, сравнение, разрезы, facts и проверки сохраняются отдельными строками SQL с JSON payload и индексами по запуску, заявке, пути и признаку изменения. Сводка читает только метаданные; атрибуты выбираются по индексу. Mart индексируется в памяти исполнителя. Pivot группирует facts в SQL; список заявок использует индексированную таблицу связей, фильтры и пагинацию в SQL. Покрывающие индексы добавляются при старте. Старые запуски, созданные до таблицы fact_members, нужно пересчитать для drill-down. Синтетические замеры приведены в docs/SQL_BENCHMARK.md. Нельзя считать скорости на четырёх samples подтверждением требований к 2002/20000 заявкам.

Перед публикацией за пределами localhost требуются HTTPS/COOKIE_SECURE, корректный ALLOWED_ORIGINS, ограничение частоты входа и подтверждённый аудит исполнения пользовательского кода. Текущий запуск — локальный прототип.
