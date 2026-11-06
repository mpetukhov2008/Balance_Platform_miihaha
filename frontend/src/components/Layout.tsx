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
  return (
    <>
      <DemoBanner />
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">Б</div>
            <div>
              <div className="brand-name">Баланс Платформа</div>
              <div className="brand-sub">Анализ изменений СПР</div>
            </div>
          </div>
          <NavLink to="/runs" className="nav-link">
            <Icon name="runs" /> Запуски
          </NavLink>
          <NavLink to="/configurations" className="nav-link">
            <Icon name="config" /> Конфигурации
          </NavLink>
          <NavLink to="/workspace" className="nav-link">
            <Icon name="code" /> Рабочая область
          </NavLink>
          <div className="sidebar-foot">
            <div className="row spread">
              <span>
                <span className="muted">Вход: </span>
                <b style={{ color: "var(--text)" }}>{session?.user.username}</b>
              </span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={toggle} title={dark ? "Светлая тема" : "Тёмная тема"} aria-label="Переключить тему">
                <Icon name={dark ? "sun" : "moon"} />
              </button>
            </div>
            <div className="row spread">
              <span className="small">API: {api.mode === "mock" ? <b style={{ color: "var(--warn)" }}>демо</b> : <b style={{ color: "var(--ok)" }}>реальный</b>}</span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>
                <Icon name="logout" /> Выйти
              </button>
            </div>
          </div>
        </aside>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </>
  );
}
