import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import { Layout } from "./components/Layout";
import { ErrorAlert, Loading } from "./components/ui";
import { Login } from "./pages/Login";
import { RunsPage } from "./pages/Runs";
import { ConfigurationsPage } from "./pages/Configurations";
import { ConfigurationEditor } from "./pages/ConfigurationEditor";
import { RunPage } from "./pages/run/RunPage";
// Редактор кода (CodeMirror) грузится отдельным чанком только для рабочей области.
const WorkspacePage = lazy(() => import("./pages/Workspace").then((m) => ({ default: m.WorkspacePage })));
const workspace = (
  <Suspense fallback={<Loading label="Загружаем редактор…" />}>
    <WorkspacePage />
  </Suspense>
);

export function App() {
  const { session, checking, bootError, retry } = useAuth();
  if (checking) return <Loading label="Проверяем сессию…" />;
  if (bootError) {
    return (
      <div style={{ maxWidth: 560, margin: "80px auto", padding: 16 }}>
        <ErrorAlert error={bootError} onRetry={retry} />
      </div>
    );
  }
  // Без сессии показываем вход на текущем URL — после входа пользователь остаётся на той же странице.
  if (!session) return <Login />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/runs" replace />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="runs/:runId/*" element={<RunPage />} />
        <Route path="configurations" element={<ConfigurationsPage />} />
        <Route path="configurations/new" element={<ConfigurationEditor />} />
        <Route path="configurations/:configId" element={<ConfigurationEditor />} />
        <Route path="workspace" element={workspace} />
        <Route path="workspace/:scriptId" element={workspace} />
        <Route path="*" element={<Navigate to="/runs" replace />} />
      </Route>
    </Routes>
  );
}
