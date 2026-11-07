import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiContext, ApiError } from "../api";
import { MockApiClient } from "../api/mock";
import { AuthProvider } from "../auth";
import { App } from "../App";
import { ModeProvider } from "../lib/mode";
import { readyMock, renderRun } from "./utils";

function renderApp(api: MockApiClient, path: string) {
  return render(
    <ApiContext.Provider value={api}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <ModeProvider>
            <App />
          </ModeProvider>
        </AuthProvider>
      </MemoryRouter>
    </ApiContext.Provider>,
  );
}

describe("Обычный и продвинутый режим", () => {
  it("в обычном режиме отчёт проверок говорит по-русски", async () => {
    localStorage.setItem("bp-mode", "simple");
    const { api, runId } = await readyMock();
    renderRun(api, `/runs/${runId}/checks`);
    const table = await screen.findByTestId("checks-table");
    expect(within(table).getByText("Итог")).toBeTruthy();
    expect(within(table).getAllByText("Проблема").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Стало").length).toBeGreaterThan(0);
    expect(within(table).queryByText("FAIL")).toBeNull();
    expect(within(table).queryByText("AFTER (BETA)")).toBeNull();
  });

  it("переключатель в меню профиля меняет подписи", async () => {
    localStorage.setItem("bp-mode", "simple");
    const { api, runId } = await readyMock();
    renderApp(api, `/runs/${runId}/checks`);
    await screen.findByTestId("checks-table");
    expect(screen.getAllByText("Проблема").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTitle("Профиль и режим интерфейса"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Продвинутый/ }));
    await waitFor(() => expect(within(screen.getByTestId("checks-table")).getAllByText("FAIL").length).toBeGreaterThan(0));
    expect(localStorage.getItem("bp-mode")).toBe("advanced");
  });
});

describe("Регистрация", () => {
  it("создаёт аккаунт и входит", async () => {
    const api = new MockApiClient();
    renderApp(api, "/runs");
    fireEvent.click(await screen.findByRole("tab", { name: "Регистрация" }));
    fireEvent.change(screen.getByLabelText(/^Имя пользователя/), { target: { value: "new_user" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: "long-password-1" } });
    fireEvent.change(screen.getByLabelText(/^Повторите пароль/), { target: { value: "long-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    await screen.findByText("Запуски", { selector: "h1" });
  });

  it("если сервер не поддерживает регистрацию, честно говорит об этом", async () => {
    const api = new MockApiClient();
    vi.spyOn(api, "register").mockRejectedValue(new ApiError(404, "NOT_FOUND", "Not Found"));
    renderApp(api, "/runs");
    fireEvent.click(await screen.findByRole("tab", { name: "Регистрация" }));
    fireEvent.change(screen.getByLabelText(/^Имя пользователя/), { target: { value: "new_user" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: "long-password-1" } });
    fireEvent.change(screen.getByLabelText(/^Повторите пароль/), { target: { value: "long-password-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать аккаунт" }));
    await screen.findByText(/регистрация на этом сервере закрыта/i);
  });

  it("не даёт создать аккаунт с коротким паролем или разными паролями", async () => {
    renderApp(new MockApiClient(), "/runs");
    fireEvent.click(await screen.findByRole("tab", { name: "Регистрация" }));
    fireEvent.change(screen.getByLabelText(/^Имя пользователя/), { target: { value: "new_user" } });
    fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText(/^Повторите пароль/), { target: { value: "other" } });
    expect((screen.getByRole("button", { name: "Создать аккаунт" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Пароли не совпадают")).toBeTruthy();
  });
});
