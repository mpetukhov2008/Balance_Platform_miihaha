import { createContext, useContext } from "react";
import type { ApiClient } from "./client";
import { HttpApiClient } from "./http";

export { ApiError } from "./client";
export type { ApiClient } from "./client";

/** Реальный API — по умолчанию. Демо включается только явно: VITE_USE_MOCK_API=true. */
export async function createApiClient(): Promise<ApiClient> {
  if (String(import.meta.env.VITE_USE_MOCK_API ?? "").trim().toLowerCase() === "true") {
    const { MockApiClient } = await import("./mock");
    return new MockApiClient();
  }
  return new HttpApiClient(import.meta.env.VITE_API_BASE_URL || "/api/v1");
}

export const ApiContext = createContext<ApiClient | null>(null);

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error("ApiContext не инициализирован");
  return api;
}
