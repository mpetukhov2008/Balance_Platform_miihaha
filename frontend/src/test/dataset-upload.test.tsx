import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiContext, ApiError } from "../api";
import { MockApiClient } from "../api/mock";
import { HttpApiClient } from "../api/http";
import type { Dataset } from "../api/types";
import { ConfigurationEditor } from "../pages/ConfigurationEditor";

const dataset: Dataset = { id: "custom-new", name: "Новая стратегия", kind: "CUSTOM", status: "READY", appCount: 2, description: "Загружен вами" };

async function editor() {
  const api = new MockApiClient();
  await api.login("tester", "x");
  render(<ApiContext.Provider value={api}><MemoryRouter><ConfigurationEditor /></MemoryRouter></ApiContext.Provider>);
  await screen.findByLabelText("ZIP-архив датасета");
  return api;
}

describe("Загрузка своего датасета", () => {
  it("выбирает загруженный датасет и сохраняет его в конфигурации", async () => {
    const api = await editor();
    const archive = new File(["zip bytes"], "strategy.zip", { type: "application/zip" });
    const upload = vi.spyOn(api, "uploadDataset").mockResolvedValue(dataset);
    const save = vi.spyOn(api, "createConfiguration");
    fireEvent.change(screen.getByPlaceholderText("Например: стратегия v42 — полный датасет"), { target: { value: "Сравнение новой стратегии" } });
    fireEvent.change(screen.getByLabelText("ZIP-архив датасета"), { target: { files: [archive] } });
    fireEvent.change(screen.getByLabelText("Название датасета"), { target: { value: "Новая стратегия" } });
    const submit = screen.getByRole("button", { name: "Загрузить датасет" }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await screen.findByRole("status");
    expect(upload).toHaveBeenCalledWith("Новая стратегия", archive);
    expect(screen.getByRole("button", { name: /Новая стратегия готов/ }).className).toContain("on");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ datasetId: "custom-new" })));
  });

  it("показывает ошибку проверки сервера и позволяет повторить загрузку", async () => {
    const api = await editor();
    const upload = vi.spyOn(api, "uploadDataset").mockRejectedValueOnce(new ApiError(422, "INVALID_DATASET", "Нет пары для заявки new-a."));
    fireEvent.change(screen.getByLabelText("ZIP-архив датасета"), { target: { files: [new File(["zip"], "broken.zip")] } });
    const submit = screen.getByRole("button", { name: "Загрузить датасет" }) as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await screen.findByText("Нет пары для заявки new-a.");
    expect(submit.disabled).toBe(false);
    expect((screen.getByLabelText("Название датасета") as HTMLInputElement).value).toBe("broken");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("блокирует неподдерживаемый файл до обращения к серверу", async () => {
    const api = await editor();
    const upload = vi.spyOn(api, "uploadDataset");
    fireEvent.change(screen.getByLabelText("ZIP-архив датасета"), { target: { files: [new File(["{}"], "data.json")] } });
    expect(screen.getByText("Выберите ZIP-архив.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Загрузить датасет" }) as HTMLButtonElement).disabled).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it("передаёт ZIP как двоичное тело с CSRF и cookie", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: "u", username: "tester" }, csrfToken: "csrf-test" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => dataset } as Response);
    try {
      const api = new HttpApiClient("/api/v1");
      await api.login("tester", "test");
      const archive = new File(["zip bytes"], "test.zip");
      expect(await api.uploadDataset("Новая стратегия", archive)).toEqual(dataset);
      const [url, init] = fetcher.mock.calls[1];
      expect(String(url)).toContain("/datasets?name=");
      expect(new URL(String(url), "http://localhost").searchParams.get("name")).toBe("Новая стратегия");
      expect(init).toMatchObject({ method: "POST", credentials: "include", body: archive,
        headers: { "Content-Type": "application/zip", "X-CSRF-Token": "csrf-test" } });
    } finally {
      fetcher.mockRestore();
    }
  });
});
