# Frontend — Баланс Платформа

Браузерный интерфейс системы анализа изменений СПР: React 19 + TypeScript + Vite 7. Работает с API v0.1 (`/api/v1`) из `contracts/API_CONTRACT.md`.

## Запуск

Нужен Node.js 20.19+ (проверено на 24.22). Команды выполняются из `frontend/` и одинаковы для Windows, macOS и Linux.

```bash
npm ci
npm run dev          # http://localhost:5173, реальный API через proxy
```

Backend и worker запускаются по корневому README. Vite проксирует `/api` на `VITE_PROXY_TARGET` (по умолчанию `http://127.0.0.1:8000`). Открывайте приложение именно по `http://localhost:5173`: этот origin разрешён в `ALLOWED_ORIGINS` сервера, а `127.0.0.1:5173` — нет.

Демонстрационный режим включается только явно:

```bash
npm run dev:mock     # vite --mode demo → .env.demo с VITE_USE_MOCK_API=true
```

Команда одинаково работает в Windows (cmd и PowerShell), macOS и Linux: переменная берётся из `frontend/.env.demo`, а не из синтаксиса оболочки. Для разовой настройки без файла в PowerShell: `$env:VITE_USE_MOCK_API="true"; npm run dev`, в cmd: `set "VITE_USE_MOCK_API=true" && npm run dev`.

В демо-режиме все данные искусственные, сверху висит полосатый баннер «Демонстрационные данные». Реальный режим никогда не переключается на демо при ошибке API.

## Проверки

```bash
npm run typecheck    # tsc без вывода файлов
npm test             # vitest + Testing Library (jsdom)
npm run build        # tsc + vite build → dist/
```

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `VITE_API_BASE_URL` | `/api/v1` | Базовый адрес API. В production — тот же origin |
| `VITE_PROXY_TARGET` | `http://127.0.0.1:8000` | Куда dev-сервер проксирует `/api` |
| `VITE_USE_MOCK_API` | `false` | `true` — демо-адаптер вместо сервера |

## Устройство

- `src/api/client.ts` — интерфейс `ApiClient` и `ApiError`. Компоненты знают только его.
- `src/api/http.ts` — `HttpApiClient`: `credentials: include`, `X-CSRF-Token` из ответа входа (в памяти, не в localStorage), разбор `{error:{code,message,details}}`, вызов `onUnauthorized` при 401.
- `src/api/mock.ts`, `mockData.ts` — `MockApiClient` на тех же DTO: задержанный RUNNING, FAILED (в названии конфигурации есть «fail»/«ошиб»), 401 (кнопка в баннере), PIVOT_TOO_WIDE, DRILLDOWN_EXPIRED.
- `src/pages/run/*` — запуск: ход выполнения, сводка, сводная, заявки, карточка заявки и атрибута, проверки, ИИ и HTML.
- `src/pages/Workspace*.tsx` — рабочая область Python (CodeMirror 6, отдельный чанк).

Маршруты: `/runs`, `/runs/:id/{status,summary,pivot,checks,report,apps,apps/:appId}`, `/configurations[/new|/:id]`, `/workspace[/:scriptId]`. Раскладка сводной хранится в URL (`rows`, `cols`, `f`, `page`), поэтому «назад» из деталей возвращает ту же сводную. Ссылки из серверного HTML (`/runs/:id` и `/runs/:id/checks?rowId=`) открываются в приложении; без сессии показывается вход на том же URL.

## Зависимости

Runtime: `react`, `react-dom`, `react-router-dom`, `@uiw/react-codemirror` + `@codemirror/lang-python` (MIT), шрифт `@fontsource-variable/manrope` (OFL, локально в бандле). Палитра и темы — токены в `src/styles/tokens.css`. Сводная — собственная таблица поверх серверной pivot-выборки, без сторонних pivot-компонентов и CDN. Версии зафиксированы точно, есть `package-lock.json`.
