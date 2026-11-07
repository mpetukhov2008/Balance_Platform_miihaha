import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "bp-theme";

/** Тёмная тема по умолчанию; светлая — только если пользователь выбрал её сам. */
export function storedTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute("data-theme", t);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* тема — только удобство */
    }
  }, [theme]);
  return { dark: theme === "dark", toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}
