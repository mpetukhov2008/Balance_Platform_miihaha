import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useApi } from "../api";
import type { MockApiClient } from "../api/mock";
import { useAuth } from "../auth";
import { Icon } from "./Icon";
import { BrandLogo } from "./BrandLogo";
import { AppFooter, HackChip } from "./Hack";
import { useTheme } from "../lib/theme";
import { BRAND } from "../lib/brand";
import { useTerms, type Mode } from "../lib/mode";

export function DemoBanner() {
  const api = useApi();
  if (api.mode !== "mock") return null;
  return (
    <div className="demo-banner" role="status">
      <Icon name="alert" size={15} /> Демонстрационные данные — искусственный набор, не результат сервера и не подтверждение интеграции
      <button className="btn btn-sm" onClick={() => (api as unknown as MockApiClient).expireSession()} title="Имитировать истёкшую сессию (401)">
        Сбросить сессию (401)
      </button>
    </div>
  );
}

/** Значок профиля с меню: режим интерфейса и выход. */
function ProfileMenu({ name, demo, onLogout }: { name: string; demo: boolean; onLogout: () => void }) {
  const terms = useTerms();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const option = (m: Mode, title: string, hint: string) => (
    <button role="menuitemradio" aria-checked={terms.mode === m} className={`mode-opt ${terms.mode === m ? "on" : ""}`} onClick={() => terms.setMode(m)}>
      <span className="mode-radio" aria-hidden="true" />
      <span>
        <b>{title}</b>
        <small>{hint}</small>
      </span>
    </button>
  );
  return (
    <div className="profile" ref={ref}>
      <button className="profile-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Профиль и режим интерфейса">
        <span className="avatar" aria-hidden="true">{name.slice(0, 1)}</span>
        <span className="top-meta">
          <b>{name}</b>
          <small>
            <i className="mode-dot" style={{ background: demo ? "var(--warn)" : "var(--ok)" }} />
            {terms.simple ? "обычный режим" : "продвинутый режим"}
          </small>
        </span>
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-head">
            <b>{name}</b>
            <small>{demo ? "Демонстрационные данные" : "Подключено к серверу"}</small>
          </div>
          <div className="menu-label">Режим интерфейса</div>
          {option("simple", "Обычный", "Понятные русские подписи без технических терминов")}
          {option("advanced", "Продвинутый", "Технические поля и коды: BEFORE/AFTER, PATH, CHANGE_TYPE")}
          <div className="sep" />
          <button role="menuitem" className="mode-opt" onClick={onLogout}>
            <Icon name="logout" /> <span><b>Выйти</b></span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { session, logout } = useAuth();
  const api = useApi();
  const { dark, toggle } = useTheme();
  const name = session?.user.username ?? "";
  return (
    <div className="app">
      <DemoBanner />
      <header className="topbar">
        <div className="topbar-in">
          <NavLink to="/runs" className="brand" aria-label={`${BRAND.name} — на главную`}>
            <BrandLogo height={38} />
            <span className="brand-divider" aria-hidden="true" />
            <div className="brand-sub">Анализ<br />изменений СПР</div>
          </NavLink>
          <span className="top-hack"><HackChip /></span>
          <nav className="nav" aria-label="Разделы">
            <NavLink to="/runs" className="nav-link">
              <Icon name="runs" /> Запуски
            </NavLink>
            <NavLink to="/configurations" className="nav-link">
              <Icon name="config" /> Конфигурации
            </NavLink>
            <NavLink to="/workspace" className="nav-link">
              <Icon name="code" /> Рабочая область
            </NavLink>
          </nav>
          <div className="top-user">
            <ProfileMenu name={name} demo={api.mode === "mock"} onLogout={logout} />
            <button className="top-btn" onClick={toggle} title={dark ? "Светлая тема" : "Тёмная тема"} aria-label="Переключить тему">
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            <button className="top-btn" onClick={logout}>
              <Icon name="logout" /> Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <Outlet />
      </main>
      <AppFooter />
    </div>
  );
}
