import { useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, useApi } from "../api";
import { useAuth } from "../auth";
import { DemoBanner } from "../components/Layout";
import { ErrorAlert } from "../components/ui";
import { Icon } from "../components/Icon";
import { BrandLogo } from "../components/BrandLogo";
import { Bracket, GhostTitle, HACK, Orbit, SupportLink } from "../components/Hack";
import { BRAND } from "../lib/brand";
import { useTheme } from "../lib/theme";
import { useTerms } from "../lib/mode";
import { useAsync } from "../lib/hooks";

const NAME_RE = /^[A-Za-z0-9_.-]{3,40}$/;

/** Сайт открыт по незащищённому HTTP не на локальной машине — пароль пойдёт открытым текстом. */
function insecureOrigin() {
  const { protocol, hostname } = window.location;
  return protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname) && !hostname.endsWith(".localhost");
}

function PasswordField({ label, value, onChange, autoComplete, invalid, hint }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; hint?: string }) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <label className="field">
      <span>{label}</span>
      <span className="pw">
        <input aria-label={label} className={`input ${invalid ? "invalid" : ""}`} type={shown ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} onKeyUp={onKey} onKeyDown={onKey} required />
        <button type="button" className="pw-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? "Скрыть пароль" : "Показать пароль"} title={shown ? "Скрыть пароль" : "Показать пароль"}>
          <Icon name="eye" />
        </button>
      </span>
      {caps && <span className="err">Включён Caps Lock</span>}
      {hint && <span className={invalid ? "err" : "muted small"}>{hint}</span>}
    </label>
  );
}

function errorText(err: unknown, mode: "login" | "register") {
  if (!(err instanceof ApiError)) return null;
  if (err.status === 429) return "Слишком много попыток. Подождите немного и попробуйте снова.";
  if (mode === "login" && (err.status === 401 || err.status === 403)) return "Неверное имя пользователя или пароль.";
  if (mode === "register" && (err.status === 404 || err.status === 405 || err.status === 501 || err.code === "REGISTRATION_DISABLED")) return "closed";
  if (mode === "register" && err.status === 409) return "Такое имя пользователя уже занято.";
  return null;
}

export function Login() {
  const { login, register, expired } = useAuth();
  const api = useApi();
  const t = useTerms();
  const { dark, toggle } = useTheme();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [closedByServer, setClosedByServer] = useState(false);
  // Настройки регистрации сообщает сервер; старый сервер без /auth/options — регистрация закрыта.
  const options = useAsync(() => api.registrationOptions(), [api]);
  const MIN_PASSWORD = options.data?.passwordMinLength ?? 15;
  const closed = closedByServer || options.error !== undefined || options.data?.registrationEnabled === false;

  const nameOk = NAME_RE.test(username.trim());
  const pwOk = password.length >= MIN_PASSWORD;
  const sameOk = password === password2;
  const canRegister = nameOk && pwOk && sameOk && !closed;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (tab === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
    } catch (err) {
      if (tab === "register" && errorText(err, "register") === "closed") setClosedByServer(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  const switchTab = (next: "login" | "register") => {
    setTab(next);
    setError(undefined);
    setPassword("");
    setPassword2("");
  };
  const friendly = error !== undefined ? errorText(error, tab) : null;

  return (
    <>
      <DemoBanner />
      <div className="login-wrap">
        <div className="login-side">
          <Orbit />
          <GhostTitle text={HACK.name} />
          <div className="login-logo">
            <BrandLogo height={72} />
            <div className="brand-sub">{BRAND.tagline}</div>
          </div>
          <div>
            <div className="login-kicker">
              <Bracket accent href={HACK.url}>{HACK.name}</Bracket>
              <Bracket>{HACK.dates}</Bracket>
              <Bracket>команда {HACK.team}</Bracket>
            </div>
            <h1 className="login-hero">Что изменилось, у кого и почему — <em>до запуска новой версии.</em></h1>
            <ul className="login-points">
              <li><Icon name="swap" /> Сравнение решений старой и новой версии стратегии</li>
              <li><Icon name="table" /> Таблица изменений с переходом до конкретной заявки и поля</li>
              <li><Icon name="shield" /> Единый отчёт автоматических проверок</li>
            </ul>
          </div>
          <div className="login-foot">
            <SupportLink />
            <div className="muted small">{BRAND.disclaimer}</div>
          </div>
        </div>
        <form className="login-card card" onSubmit={submit} noValidate>
          <div className="row spread">
            <div className="seg" role="tablist" aria-label="Вход или регистрация">
              <button type="button" role="tab" aria-selected={tab === "login"} className={tab === "login" ? "on" : ""} onClick={() => switchTab("login")}>Вход</button>
              <button type="button" role="tab" aria-selected={tab === "register"} className={tab === "register" ? "on" : ""} onClick={() => switchTab("register")}>Регистрация</button>
            </div>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={toggle} title={dark ? "Светлая тема" : "Тёмная тема"} aria-label="Переключить тему">
              <Icon name={dark ? "sun" : "moon"} />
            </button>
          </div>
          {expired && tab === "login" && (
            <div className="alert alert-warn">
              <Icon name="info" />
              <div>Сессия истекла. Войдите снова — вы вернётесь на ту же страницу.</div>
            </div>
          )}
          {insecureOrigin() && (
            <div className="alert alert-bad">
              <Icon name="alert" />
              <div>Соединение не защищено (HTTP). Не вводите пароль, пока сайт не откроется по HTTPS.</div>
            </div>
          )}
          {tab === "register" && closed && !options.loading ? (
            <div className="alert alert-info">
              <Icon name="info" />
              <div>
                <b>Самостоятельная регистрация на этом сервере закрыта.</b>
                <div style={{ marginTop: 4 }}>Чтобы получить доступ, напишите в техподдержку — администратор создаст вам учётную запись.</div>
              </div>
            </div>
          ) : (
            <>
              <label className="field">
                <span>Имя пользователя</span>
                <input aria-label="Имя пользователя" className={`input ${tab === "register" && username && !nameOk ? "invalid" : ""}`} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
                {tab === "register" && <span className={username && !nameOk ? "err" : "muted small"}>3–40 символов: латинские буквы, цифры, точка, дефис, подчёркивание</span>}
              </label>
              <PasswordField
                label="Пароль"
                value={password}
                onChange={setPassword}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                invalid={tab === "register" && !!password && !pwOk}
                hint={tab === "register" ? `Не менее ${MIN_PASSWORD} символов — подойдёт фраза из нескольких слов. Не используйте пароль от других сайтов.` : undefined}
              />
              {tab === "register" && (
                <>
                  <PasswordField label="Повторите пароль" value={password2} onChange={setPassword2} autoComplete="new-password" invalid={!!password2 && !sameOk} hint={password2 && !sameOk ? "Пароли не совпадают" : undefined} />
                </>
              )}
            </>
          )}
          {error !== undefined && (friendly ? <div className="alert alert-bad" role="alert"><Icon name="alert" /><div>{friendly}</div></div> : <ErrorAlert error={error} compact />)}
          {!(tab === "register" && closed && !options.loading) && (
            <button className="btn btn-primary" style={{ height: 48 }} disabled={busy || (tab === "login" ? !username || !password : !canRegister)}>
              {busy ? (tab === "login" ? "Входим…" : "Создаём…") : tab === "login" ? "Войти" : "Зарегистрироваться"}
            </button>
          )}
          <div className="muted small">
            {tab === "login" ? (
              <>Нет аккаунта? <button type="button" className="linklike" onClick={() => switchTab("register")}>Создать аккаунт</button> или напишите в техподдержку.</>
            ) : (
              <>Уже есть аккаунт? <button type="button" className="linklike" onClick={() => switchTab("login")}>Войти</button></>
            )}
          </div>
          <div className="muted small">
            Сервер: <b>{window.location.host}</b>
            {(!t.simple || api.mode === "mock") && <> · API: <b>{api.mode === "mock" ? "демонстрационный (любой логин и пароль)" : "реальный сервер"}</b></>}
          </div>
        </form>
      </div>
    </>
  );
}
