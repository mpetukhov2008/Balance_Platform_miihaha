# API v0.1 — контракт приложения

Статус: реализованный контракт серверного и браузерного приложения. OpenAPI описывает запросы; этот документ уточняет семантику ответов и сценариев.

## Общие правила

- Base URL: /api/v1. JSON UTF-8, ISO 8601 UTC для дат, непрозрачные строковые ID. Все ID в URL кодировать через encodeURIComponent.
- Аутентификация: серверная сессия в HttpOnly cookie, fetch с credentials: include. Для изменяющих запросов после входа передавать X-CSRF-Token из сессии; cookie и проверку origin реализует сервер. В dev — proxy /api к backend. Не хранить пароль/сессионный токен в localStorage.
- camelCase для HTTP-обёрток, UPPER_CASE для предметных строк из исходного контракта. SOURCE = BEFORE | AFTER, в UI подписи BEFORE (MASTER) и AFTER (BETA).
- Списки: {items: T[], total: number, page: number, pageSize: number}. page начинается с 1, pageSize по умолчанию 50, максимум 200. Исключения: каталог схем/enum и ограниченные массивы внутри карточек.
- Порядок сортировки по умолчанию стабильный по id; для заявок — APP_ID. Объекты фильтра передаются в теле POST-запросов поиска, а не JSON в query.
- Ошибка: {error:{code:string,message:string,details?:object}}. 401 — нет сессии, 403 — запрещено/CSRF, 404 — объект не найден или чужой, 409 — конфликт состояния/REPORT_NOT_READY, 422 — неверный запрос. 500/503 — сервер/исполнитель недоступен.
- POST создания: 201; постановка задачи: 202; GET/поиск/обновление: 200. PATCH сохраняет переданные поля. Автоматически повторять POST запуска после сетевой ошибки нельзя: сначала проверить список запусков.
- run.status = QUEUED | RUNNING | SUCCEEDED | FAILED. stage.status = PENDING | RUNNING | SUCCEEDED | FAILED | SKIPPED. Остановку/возобновление запуска в v0.1 не обещаем.
- Ключи этапов: NORMALIZE, UNION, COMPARE, AGGREGATE, CHECKS, AI_REVIEW, PUBLISH. AI_REVIEW может быть SKIPPED; недоступность модели не меняет результаты проверок. Ошибка обязательного этапа не публикует успешный отчёт.
- Доступность результата определяется reportReady, а не наличием случайных строк в таблице. Для каждого запуска — собственный владелец. Сервер проверяет владельца во всех запросах, включая скачивание и scriptId.

## 1. Сессия и каталоги

| Метод и путь | Запрос | Ответ |
|---|---|---|
| GET /auth/options | — | {registrationEnabled,passwordMinLength} |
| POST /auth/register | {username,password} | {ok:true}, затем отдельный вход |
| GET /limits | — | суточные квоты ИИ и потребление |
| GET /datasets/upload-options | — | ограничения загрузки |
| POST /datasets?name=... | application/zip, cookie и CSRF | Dataset, HTTP 201 |
| POST /auth/login | {username,password} | Session |
| GET /auth/session | — | Session |
| POST /auth/logout | пустое тело, CSRF | {ok:true} |
| GET /datasets?page=1&pageSize=50 | — | Page<Dataset> |
| GET /scripts?kind=CHECK&page=1&pageSize=50 | kind опционален | Page<Script> |
| GET /scripts/{scriptId} | — | Script с code |
| GET /script-contracts | — | {items:ScriptContract[]} |

Session = {user:{id,username},csrfToken:string}.

Dataset = {id:string,name:string,kind:"SAMPLES"|"FULL"|"CUSTOM",status:"READY"|"UNAVAILABLE",appCount:number|null,description:string}. Встроенные наборы — samples и full. Личные ZIP-наборы сохраняются в SQL и видны только владельцу.

ScriptKind = NORMALIZE | COMPARE | AGGREGATE | CHECK.

Script = {id:string,name:string,kind:ScriptKind,sourceType:"WORKSPACE"|"FILE",code:string,filename:string|null,params:object,updatedAt:string,contractId:string,checkId:string|null}. params — текущие значения по умолчанию; CHECK.checkId соответствует выданному CHECK.id. filename — серверное отображаемое имя, не абсолютный путь для чтения с диска клиента.

ScriptContract = {id:string,kind:ScriptKind,description:string,inputDescription:string,outputDescription:string,template:string}. Фронт показывает полученный шаблон; не придумывает сигнатуры нормализации/сравнения/агрегации.

## 2. Скрипты и рабочая область

| Метод и путь | Запрос | Ответ |
|---|---|---|
| POST /scripts | {name,kind,sourceType:"WORKSPACE",code,params,contractId} | Script |
| PATCH /scripts/{id} | {name?,code?,params?}; FILE не редактируется в v0.1 | Script |
| POST /script-executions | {scriptId,params:object,datasetId?:string,runId?:string} | {executionId:string} |
| GET /script-executions/{id} | — | ScriptExecution |

Для NORMALIZE/COMPARE/AGGREGATE требуется datasetId; это отдельный предварительный запуск на выбранном наборе с выполнением необходимых предыдущих этапов сервером и ограниченным предпросмотром. Для CHECK требуется runId с готовой витриной. В v0.1 предварительная проверка CHECK через /script-executions не меняет опубликованный отчёт; включение в него — специальный endpoint из раздела 7.

ScriptExecution = {id:string,status:"QUEUED"|"RUNNING"|"SUCCEEDED"|"FAILED",stdout:string,stderr:string,diagnostics:object[],previewRows:object[],truncated:boolean,error:string|null}. previewRows и вывод ограничены сервером; длительное исполнение опрашивается, не держит HTTP-соединение до конца.

Для FILE пользователь выбирает уже зарегистрированный Script из каталога; произвольная загрузка и редактирование серверных файлов через браузер не требуется. Предоставленные .py регистрирует сервер.

## 3. Конфигурации и запуски

Binding = {scriptId:string,params:object}. Параметры JSON редактируются и валидируются как объект. Для CHECK исходные DEFAULTS извлекает сервер; UI не исполняет Python для чтения метаданных.

ConfigurationBody = {name:string,datasetId:string,normalizer:Binding,comparator:Binding,aggregator:Binding,checks:Binding[],aiReviewEnabled:boolean}. Исключения полей, ключи массивов и бакеты — параметры выбранного normalizer; UI допускает JSON-редактор параметров без зашивания предметных путей в компоненты.

Configuration = ConfigurationBody & {id:string,createdAt:string,updatedAt:string}.

| Метод и путь | Запрос | Ответ |
|---|---|---|
| GET /configurations?page=1&pageSize=50 | — | Page<Configuration> |
| GET /configurations/{id} | — | Configuration |
| POST /configurations | ConfigurationBody | Configuration |
| PATCH /configurations/{id} | частичный ConfigurationBody | Configuration |
| POST /runs | {configurationId:string} | {id:string,status:"QUEUED"} |
| GET /runs?page=1&pageSize=50 | — | Page<Run> |
| GET /runs/{id} | — | Run |
| GET /runs/{id}/logs?after=0&limit=200 | курсор записи, не page | {items:LogEntry[],nextCursor:number,hasMore:boolean} |

Run = {id:string,configurationId:string,datasetId:string,datasetName:string,status:RunStatus,reportReady:boolean,createdAt:string,startedAt:string|null,finishedAt:string|null,stages:Stage[],error:string|null}.

Stage = {key:StageKey,status:StageStatus,processed:number|null,total:number|null,scriptId:string|null,startedAt:string|null,finishedAt:string|null,error:string|null}.

LogEntry = {cursor:number,time:string,stageKey:StageKey|null,level:"INFO"|"WARNING"|"ERROR",message:string,scriptId:string|null}.

Конфигурация сохраняется отдельно; запуск исполняет её параметры, выбранные при старте. Код скрипта при старте загружается worker как единый согласованный текст; журнал ведёт к текущему Script, как требует карточка. UI не обещает историческую версию. Повторный запуск создаёт новый Run.

## 4. Общая сводка

GET /runs/{id}/summary →

```json
{
  "totalApps": 4,
  "changedApps": null,
  "decisionChangedApps": 2,
  "decisionTransitions": [
    {"before":"REJECT","after":"APPROVE","count":1},
    {"before":"REJECT","after":"REJECT","count":1},
    {"before":"APPROVE","after":"APPROVE","count":1},
    {"before":"APPROVE","after":"REJECT","count":1}
  ],
  "topChangedAttributes": [],
  "externalDriftDecisionApps": null,
  "timingsMs": {},
  "computedAt": "2026-11-06T18:00:00Z"
}
```

Это пример формы на samples, не ответ существующего сервера. changedApps/externalDriftDecisionApps=null означают «не вычислено», не 0. После успешной реализации сервер возвращает вычисленные числа. topChangedAttributes: Array<{PATH:string,changedApps:number}>. timingsMs: Record<StageKey,number>. Все числовые KPI берутся из ответа, а не из суммы pivot.

## 5. Pivot и фильтры

GET /runs/{id}/dimensions → {items:Array<{name:string,label:string,type:"string"|"number"|"boolean",canGroup:boolean,canFilter:boolean}>}.

Доступные обязательные поля facts: PREFIX, CLASS, SUFFIX, ARRAY_KEY, KEY, PATH, VALUE_ADJUSTED, DIFF_FLAG, CHANGE_TYPE, SOURCE. Дополнительные разрезы — PRODUCTS, PARTNER_TYPE, ROUTING_METHOD, DECISION_CHANGED, DECISION_BEFORE, DECISION_AFTER. Показывать только объявленные сервером поля. PRODUCTS как фильтр означает членство в наборе, не сравнение со всей строкой продуктов. Разворачивание продуктов для группировки может создавать несколько участий заявки — это учитывает сервер и объясняет метаданные меры.

Scalar = string | number | boolean | null. Filter = {field:string,op:"eq"|"in",value:Scalar|Scalar[]}. in требует массив. Filter[] объединяется через И. Имя поля берётся из dimensions; SQL или произвольные выражения не передаются.

POST /runs/{id}/pivot/query

```json
{
  "rows": ["PREFIX","CLASS","KEY","VALUE_ADJUSTED"],
  "columns": ["DIFF_FLAG","SOURCE"],
  "filters": [{"field":"CHANGE_TYPE","op":"in","value":["VALUE_CHANGED","ATTRIBUTE_NEW","ATTRIBUTE_LOST"]}],
  "measure": "SUM_CNT",
  "page": 1,
  "pageSize": 50
}
```

Ответ:

```json
{
  "rowFields": ["PREFIX","CLASS","KEY","VALUE_ADJUSTED"],
  "columnFields": ["DIFF_FLAG","SOURCE"],
  "rowKeys": [["decisionResult","","decision","APPROVE"]],
  "columnKeys": [[1,"AFTER"]],
  "cells": [
    {"rowIndex":0,"columnIndex":0,"value":1,"drilldownToken":"opaque-server-token"}
  ],
  "totalRows": 1,
  "page": 1,
  "pageSize": 50,
  "measure": {"id":"SUM_CNT","label":"Участия заявок в группах","additive":true},
  "uniqueApps": 1
}
```

Форма ответа иллюстративная; конкретные разложения PREFIX/CLASS берутся из данных. rowIndex относится к rowKeys текущей страницы; columnIndex — к columnKeys. Отсутствующая ячейка отображается как пустая/0 по принятому UI-правилу, но не имеет клика, пока нет token. Пагинация применяется к группам строк, не к деталям и не отдельно к уже возвращённым cells. Если число колонок слишком велико, сервер возвращает 422 PIVOT_TOO_WIDE; UI предлагает уменьшить разрез/добавить фильтр, не показывает обрезанный итог как полный.

value — сумма CNT, uniqueApps — уникальные заявки во всём отфильтрованном наборе. Для ячейки, объединяющей несколько атрибутов, value может быть больше числа уникальных заявок drill-down. Не подписывать SUM_CNT как уникальные заявки во всех раскладках. Не добавлять общий итог «всего заявок» простым суммированием cells.

drilldownToken — непрозрачная серверная ссылка на все предикаты ячейки и исходные фильтры. UI не реконструирует её из видимых подписей. Работает только для владельца и конкретного прогона. Протухший token → 409 DRILLDOWN_EXPIRED; повторить pivot-запрос.

## 6. Заявки и атрибуты

POST /runs/{id}/applications/query

Request = {drilldownToken?:string,checkRowId?:string,filters?:Filter[],page:number,pageSize:number}. drilldownToken и checkRowId взаимоисключающие; filters дополнительно сужают выборку.

Response = Page<ApplicationItem> & {scope:"FULL_GROUP"|"CHECK_SAMPLE"|"FILTER",matchedAttributes:Array<{PATH:string,ARRAY_KEY:string}>|null}.

ApplicationItem = {APP_ID:string,DECISION_BEFORE:string|null,DECISION_AFTER:string|null,DECISION_CHANGED:0|1,changedAttributes:number|null}. У CHECK_SAMPLE total — размер реально возвращённой проверкой выборки, не CNT. matchedAttributes — только ограниченная подсказка; при большой группе может быть null.

GET /runs/{id}/applications/{appId} → {APP_ID:string,segments:Record<string,unknown>,decisionEvidence:Array<{kind:string,text:string,PATH:string|null,ARRAY_KEY:string|null}>,evidenceNote:string}. Поля segments соответствуют схеме слоя разрезов. decisionEvidence — наблюдаемые факты, не автоматически доказанная причинность.

POST /runs/{id}/applications/{appId}/attributes/query

Request = {diffOnly:boolean,path?:string,arrayKey?:string,drilldownToken?:string,page:number,pageSize:number}.

Response = Page<ComparisonRow>.

ComparisonRow содержит обязательные поля из docs/СХЕМА_ВИТРИНЫ.md:

```text
APP_ID PREFIX CLASS SUFFIX ARRAY_KEY KEY PATH
VALUE_BEFORE VALUE_AFTER ADJUSTED_BEFORE ADJUSTED_AFTER
DIFF_FLAG CHANGE_TYPE
```

Все значения строковые кроме DIFF_FLAG (0/1). VALUE_* при отсутствии атрибута — пустая строка; JSON null сериализуется сервером по принятой политике. CHANGE_TYPE определяет отсутствие. Сервер сохраняет дополнительную информацию о типе/наличии, если нужна для неоднозначных значений. Для UI допустимы дополнительные presentBefore/presentAfter (boolean), valueTypeBefore/valueTypeAfter (string|null), не меняющие контракт MartAPI. Если они есть, использовать их для точного представления.

GET /runs/{id}/applications/{appId}/raw?source=BEFORE → {APP_ID:string,SOURCE:"BEFORE"|"AFTER",document:object}.

Пара PATH+ARRAY_KEY идентифицирует атрибут внутри заявки. Группа pivot может соответствовать многим атрибутам: тогда карточка должна показывать отфильтрованный набор, а не выдумывать один выделенный атрибут. URL интерфейса может хранить path/arrayKey или token; список всех APP_IDS в URL не помещать.

## 7. Проверки, ИИ и документ

| Метод и путь | Запрос | Ответ |
|---|---|---|
| GET /runs/{id}/check-results?page=1&pageSize=50 | — | Page<CheckResult> & {reportRevision:number} |
| POST /runs/{id}/check-executions | {scriptId:string,params:object} | {executionId:string} |
| GET /runs/{id}/check-executions/{executionId} | — | {id,status,error:string|null,reportRevision:number|null} |
| POST /runs/{id}/ai-review | пустой объект | {executionId:string}, фоновая генерация |
| GET /runs/{id}/ai-review | — | AiReview |
| GET /runs/{id}/report | — | text/html, документ в браузере |
| GET /runs/{id}/report.html | — | text/html, Content-Disposition: attachment |

CheckResult = {rowId:string,checkId:string,LABEL:string,SOURCE:"BEFORE"|"AFTER",ARGUMENT:string,CNT:number,TOTAL:number,METRIC:number,APP_IDS:string[],RESULT:"PASS"|"FAIL",CONFIDENCE:"HIGH"|"LOW"}.

METRIC должна быть конечным числом. Единицы определяет проверка; клиент не приписывает метрике проценты автоматически.

Новая проверка выполняется сервером на готовой витрине без повторной нормализации, затем атомарно обновляет единый отчёт и HTML. Повторный запуск того же CHECK.id заменяет его прошлые строки, не создаёт незаметные дубли. reportRevision — номер пересборки отчёта, не версия кода. Старые checkRowId после замены могут стать недействительными; обновить таблицу. Ошибка CHECK отображается как ошибка исполнения, не как PASS. После успешного check-execution UI перечитывает check-results и ai-review.

AiReview = {status:"DISABLED"|"PENDING"|"READY"|"UNAVAILABLE"|"FAILED"|"STALE",text:string|null,error:string|null,generatedAt:string|null,reportRevision:number|null}. После изменения отчёта прежнее мнение может быть STALE до повторной генерации; не показывать его как мнение о новых результатах.

HTML создаёт сервер: объединённые проверки, сводка, ИИ-статус и абсолютные ссылки в приложение. Для скачивания через fetch проверять HTTP-статус до преобразования в Blob. Не сохранять ответ с ошибкой как report.html. Ссылки из скачанного документа не обходят аутентификацию.

## 8. Браузерный клиент

Единый ApiClient реализован HttpApiClient и MockApiClient. Реальный API используется по умолчанию; демо включается только явным VITE_USE_MOCK_API=true. Ошибка реального API не переключает приложение на искусственные данные. В демо используются три искусственные заявки, Python и серверная загрузка ZIP не имитируются как реальные вычисления. Вопросы единиц METRIC и типов предметных значений решаются контрактом проверки, а не догадкой интерфейса.
