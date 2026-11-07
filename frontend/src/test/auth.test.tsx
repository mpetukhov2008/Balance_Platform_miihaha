import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiContext } from "../api";
import { MockApiClient } from "../api/mock";
import { AuthProvider } from "../auth";
import { App } from "../App";

describe("Сессия", () => {
  it("создаёт аккаунт только после совпадения паролей и входит", async () => {
    const api = new MockApiClient();
    const signup = vi.spyOn(api, "register");
    render(<ApiContext.Provider value={api}><MemoryRouter initialEntries={["/configurations"]}><AuthProvider><App /></AuthProvider></MemoryRouter></ApiContext.Provider>);
    fireEvent.click(await screen.findByRole("button", { name: "Создать аккаунт" }));
    fireEvent.change(screen.getByLabelText("Имя пользователя"), { target: { value: "new-user" } });
    fireEvent.change(screen.getByLabelText("Пароль"), { target: { value: "a long passphrase 2026" } });
    const submit = screen.getByRole("button", { name: "Зарегистрироваться" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Повторите пароль"), { target: { value: "a long passphrase 2026" } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await screen.findByText("Конфигураций пока нет");
    expect(signup).toHaveBeenCalledWith("new-user", "a long passphrase 2026");
  });
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
