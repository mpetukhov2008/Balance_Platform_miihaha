import { useState, type FormEvent } from "react";
import { useApi } from "../api";
import { useAuth } from "../auth";
import { DemoBanner } from "../components/Layout";
import { ErrorAlert } from "../components/ui";
import { Icon } from "../components/Icon";
import { BrandLogo } from "../components/BrandLogo";
import { Bracket, HACK, Orbit } from "../components/Hack";
import { useAsync } from "../lib/hooks";

export function Login() {
  const { login, expired } = useAuth();
  const api = useApi();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const options = useAsync(() => api.registrationOptions(), [api]);
  const [registering, setRegistering] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const minLength = options.data?.passwordMinLength ?? 15;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (registering) await api.register(username.trim(), password);
      await login(username.trim(), password);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DemoBanner />
      <div className="login-wrap">
        <div className="login-side">
          <Orbit />
          <div className="ghost-text" aria-hidden="true">Nuclear IT Hack</div>
          <div className="login-logo">
            <BrandLogo height={72} />
            <div className="brand-sub">Анализ изменений СПР</div>
          </div>
          <div>
            <div className="login-kicker">
              <Bracket accent href={HACK.url}>{HACK.name}</Bracket>
              <Bracket>{HACK.dates}</Bracket>
              <Bracket>команда {HACK.team}</Bracket>
            </div>
            <h1 className="login-hero">Что изменилось, у кого и из-за чего — <em>до выката на прод.</em></h1>
            <ul className="login-points">
              <li><Icon name="swap" /> Сравнение ответов BEFORE (MASTER) и AFTER (BETA)</li>
              <li><Icon name="table" /> Сводная с изменяемой раскладкой и переходом до атрибута</li>
              <li><Icon name="shield" /> Единый отчёт PASS / FAIL по проверкам на Python</li>
            </ul>
          </div>
          <div className="muted small">Проект хакатона {HACK.name} · {options.data?.registrationEnabled ? "создайте аккаунт, чтобы начать работу." : "пользователей создаёт администратор сервера."}</div>
        </div>
        <form className="login-card card" onSubmit={submit}>
          <h2 style={{ fontSize: 20 }}>{registering ? "Регистрация" : "Вход"}</h2>
          {expired && (
            <div className="alert alert-warn">
              <Icon name="info" />
              <div>Сессия истекла. Войдите снова — вы вернётесь на ту же страницу.</div>
            </div>
          )}
          <label className="field">
            <span>Имя пользователя</span>
            <input aria-label="Имя пользователя" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required minLength={registering ? 3 : 1} maxLength={registering ? 40 : 100} pattern={registering ? "[A-Za-z0-9_.\\-]+" : undefined} />
            {registering && <span className="hint">3–40 символов: латинские буквы, цифры, точка, дефис или подчёркивание.</span>}
          </label>
          <label className="field">
            <span>Пароль</span>
            <input aria-label="Пароль" className="input" type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={registering ? minLength : 1} maxLength={registering ? 128 : 1000} />
            {registering && <span className="hint">Не менее {minLength} символов. Можно использовать длинную парольную фразу.</span>}
          </label>
          {registering && <label className="field"><span>Повторите пароль</span><input className="input" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />{confirmation && confirmation !== password && <span className="hint" style={{ color: "var(--bad)" }}>Пароли не совпадают.</span>}</label>}
          {error !== undefined && <ErrorAlert error={error} compact />}
          <button className="btn btn-primary" style={{ height: 40 }} disabled={busy || !username || !password || (registering && (password.length < minLength || confirmation !== password))}>
            {busy ? "Подождите…" : registering ? "Зарегистрироваться" : "Войти"}
          </button>
          {options.data?.registrationEnabled && <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => { setRegistering(!registering); setError(undefined); setConfirmation(""); }}>{registering ? "Уже есть аккаунт — войти" : "Создать аккаунт"}</button>}
          <div className="muted small">
            Режим API: <b>{api.mode === "mock" ? "демонстрационный (любой логин и пароль)" : "реальный сервер"}</b>
          </div>
        </form>
      </div>
    </>
  );
}
