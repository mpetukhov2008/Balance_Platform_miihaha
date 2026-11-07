import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiContext } from "../api";
import { MockApiClient } from "../api/mock";
import { AuthProvider } from "../auth";
import { App } from "../App";

describe("Сессия", () => {
  it("401 во время работы возвращает ко входу на той же странице", async () => {
    const api = new MockApiClient();
    await api.login("tester", "x");
    render(
      <ApiContext.Provider value={api}>
        <MemoryRouter initialEntries={["/configurations"]}>
          <AuthProvider>
            <App />
          </AuthProvider>
        </MemoryRouter>
      </ApiContext.Provider>,
    );
    await screen.findByText("Конфигураций пока нет");
    api.expireSession();
    fireEvent.click(screen.getByText("Запуски"));
    await screen.findByText(/Сессия истекла/);
    expect(screen.getByRole("button", { name: "Войти" })).toBeTruthy();
  });
});
