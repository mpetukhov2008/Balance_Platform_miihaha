import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ApiContext, createApiClient, type ApiClient } from "./api";
import { AuthProvider } from "./auth";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/report.css";

function Root() {
  const [api, setApi] = useState<ApiClient | null>(null);
  useEffect(() => {
    createApiClient().then(setApi);
  }, []);
  if (!api) return null;
  return (
    <ApiContext.Provider value={api}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ApiContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
