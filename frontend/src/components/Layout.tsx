import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useApi } from "../api";
import type { MockApiClient } from "../api/mock";
import { useAuth } from "../auth";
import { Icon } from "./Icon";

function useTheme() {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("bp-theme") ?? "auto";
    } catch {
      return "auto";
    }
  });
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("bp-theme", theme);
    } catch {
      /* тема — только удобство */
    }
  }, [theme]);
  const dark = theme === "dark" || (theme === "auto" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}

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
          <NavLink to="/runs" className="brand" aria-label="Баланс Платформа — на главную">
            <div className="brand-mark">Б</div>
            <div>
              <div className="brand-name">Баланс Платформа</div>
              <div className="brand-sub">Анализ изменений СПР</div>
            </div>
          </NavLink>
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
            <div className="avatar" aria-hidden="true">{name.slice(0, 1)}</div>
            <div className="top-meta">
              <b>{name}</b>
              <small>
                <i className="mode-dot" style={{ background: api.mode === "mock" ? "var(--warn)" : "var(--ok)" }} />
                {api.mode === "mock" ? "демо-данные" : "реальный API"}
              </small>
            </div>
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
    </div>
  );
}
