// Проверки исправлений по FRONTEND_REVIEW (07.11.2026). Каждый тест ожидает ПРАВИЛЬНОЕ поведение.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiContext } from "../api";
import type { CheckResult, PivotResult } from "../api/types";
import { MockApiClient } from "../api/mock";
import { ConfigurationEditor } from "../pages/ConfigurationEditor";
import { WorkspaceRun } from "../pages/WorkspaceRun";
import { readyMock, renderRun } from "./utils";

function withApi(api: MockApiClient, path: string, ui: React.ReactNode, routePath = "*") {
  return render(
    <ApiContext.Provider value={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={ui} />
        </Routes>
      </MemoryRouter>
    </ApiContext.Provider>,
  );
}

describe("1. Отчёт проверок больше 200 строк", () => {
  function bigReport(api: MockApiClient) {
    const rows: CheckResult[] = Array.from({ length: 201 }, (_, i) => ({
      rowId: `row-${i}`, checkId: "big", LABEL: i === 200 ? "Последняя FAIL" : `Строка ${i}`, SOURCE: "AFTER", ARGUMENT: String(i),
      CNT: 1, TOTAL: 10, METRIC: 0.1, APP_IDS: [], RESULT: i === 200 ? "FAIL" : "PASS", CONFIDENCE: "HIGH",
    }));
    return vi.spyOn(api, "checkResults").mockImplementation(async (_r, page = 1, pageSize = 50) => ({
      items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, reportRevision: 3,
    }));
  }

  it("загружает все страницы и считает FAIL/PASS по полному отчёту", async () => {
    const { api, runId } = await readyMock();
    const spy = bigReport(api);
    renderRun(api, `/runs/${runId}/checks`);
    const totals = await screen.findByTestId("checks-totals");
    expect(totals.textContent).toContain("201 строк");
    expect(totals.textContent).toContain("FAIL 1");
    expect(totals.textContent).toContain("PASS 200");
    expect(spy.mock.calls.some((c) => c[1] === 2)).toBe(true);
    // Последняя строка доступна через пагинацию таблицы.
    fireEvent.click(screen.getByLabelText("Следующая страница"));
    fireEvent.click(screen.getByLabelText("Следующая страница"));
    fireEvent.click(screen.getByLabelText("Следующая страница"));
    fireEvent.click(screen.getByLabelText("Следующая страница"));
    expect(within(screen.getByTestId("checks-table")).getByText("Последняя FAIL")).toBeTruthy();
  });

  it("ссылка ?rowId= на строку за пределами первой страницы открывает её страницу и выделяет строку", async () => {
    const { api, runId } = await readyMock();
    bigReport(api);
    renderRun(api, `/runs/${runId}/checks?rowId=row-200`);
    const table = await screen.findByTestId("checks-table");
    await waitFor(() => expect(table.querySelector("tr.selected")?.textContent).toContain("Последняя FAIL"));
    expect(screen.getByText((_, el) => el?.tagName === "SPAN" && el.textContent === "5 / 5")).toBeTruthy();
  });

  it("каталог проверок загружается целиком, а не первой страницей", async () => {
    const { api, runId } = await readyMock();
    const spy = vi.spyOn(api, "scripts");
    renderRun(api, `/runs/${runId}/checks`);
    await screen.findByTestId("add-check");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // Ответ мока целиком помещается в первую страницу — второй запрос не нужен, но размер страницы явный.
    expect(spy.mock.calls[0][1]).toBe(1);
  });
});

describe("2. Валидность JSON-параметров", () => {
  it("ошибка JSON отключённой проверки не блокирует сохранение конфигурации", async () => {
    const api = new MockApiClient();
    await api.login("t", "x");
    withApi(api, "/configurations/new", <ConfigurationEditor />);
    const name = await screen.findByPlaceholderText(/стратегия v42/);
    fireEvent.change(name, { target: { value: "Тест" } });
    const save = screen.getByRole("button", { name: /^Сохранить$/ });
    const label = screen.getByText("stop_factor_disappeared");
    const proc = label.closest(".proc") as HTMLElement;
    fireEvent.change(within(proc).getByRole("textbox"), { target: { value: "{" } });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(proc).getByRole("checkbox"));
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("button", { name: /Сохранить и запустить/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("смена проверки с такими же параметрами сбрасывает ошибку и разблокирует запуск", async () => {
    const { api, runId } = await readyMock();
    renderRun(api, `/runs/${runId}/checks`);
    const panel = await screen.findByTestId("add-check");
    const select = within(panel).getByRole("combobox") as HTMLSelectElement;
    const button = within(panel).getByRole("button", { name: /Выполнить и добавить/ }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    const textarea = within(panel).getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "{" } });
    expect(button.disabled).toBe(true);
    const other = [...select.options].find((o) => o.value !== select.value)!.value;
    fireEvent.change(select, { target: { value: other } });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(() => JSON.parse(textarea.value)).not.toThrow();
  });

  it("рабочая область не запускает скрипт с невалидным JSON", async () => {
    const { api } = await readyMock();
    const script = await api.script("file-check_external_score_drift");
    withApi(api, "/", <WorkspaceRun script={script} params={{}} paramsValid={false} dirty={false} beforeRun={async () => script} />);
    const panel = await screen.findByTestId("workspace-run");
    await screen.findByText("Исправьте JSON параметров, чтобы выполнить.");
    for (const b of within(panel).getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("3. Сводная во время пересчёта", () => {
  it("старые ячейки недоступны, а переход использует token и фильтры одного ответа", async () => {
    const { api, runId } = await readyMock();
    const real = api.pivot.bind(api);
    let release: (() => void) | undefined;
    const spy = vi.spyOn(api, "pivot").mockImplementation(async (rid, q) => {
      if (q.filters.some((f) => f.field === "DIFF_FLAG") && q.columns.length) await new Promise<void>((r) => (release = r));
      return real(rid, q);
    });
    const apps = vi.spyOn(api, "applications");
    renderRun(api, `/runs/${runId}/pivot?rows=KEY&cols=DIFF_FLAG`);
    const table = await screen.findByTestId("pivot-table");
    const oldButton = within(table).getAllByRole("button")[0] as HTMLButtonElement;
    fireEvent.click(screen.getByLabelText(/Только отличия/));
    await screen.findByText(/ячейки временно недоступны/);
    expect(oldButton.disabled).toBe(true);
    fireEvent.click(oldButton);
    expect(apps).not.toHaveBeenCalled();

    release!();
    await waitFor(() => expect(screen.queryByText(/ячейки временно недоступны/)).toBeNull());
    const fresh = spy.mock.results[spy.mock.results.length - 1].value as Promise<PivotResult>;
    const freshTokens = (await fresh).cells.map((c) => c.drilldownToken);
    fireEvent.click(within(screen.getByTestId("pivot-table")).getAllByRole("button")[0]);
    await screen.findByText(/Группа сводной/);
    expect(freshTokens).toContain(apps.mock.calls[0][1].drilldownToken);
    expect(screen.getByText(/DIFF_FLAG eq 1/)).toBeTruthy();
  });
});

describe("4. Смена прогона во время включения проверки", () => {
  it("отслеживание идёт по прогону, в котором проверку запустили; выбор прогона заблокирован", async () => {
    const { api, runId: runA } = await readyMock();
    const cfg = (await api.configurations()).items[0];
    const { id: runB } = await api.startRun(cfg.id);
    for (let i = 0; i < 30 && !(await api.run(runB)).reportReady; i++);
    const script = await api.createScript({ name: "Моя", kind: "CHECK", sourceType: "WORKSPACE", code: 'CHECK = {"id": "mine"}', params: {}, contractId: "check-v1" });
    const track = vi.spyOn(api, "checkExecution");
    withApi(api, "/", <WorkspaceRun script={script} params={{}} dirty={false} beforeRun={async () => script} initialRunId={runA} />);
    const panel = await screen.findByTestId("workspace-run");
    const select = within(panel).getByRole("combobox") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe(runA));
    const include = within(panel).getByRole("button", { name: /Включить в отчёт/ }) as HTMLButtonElement;
    await waitFor(() => expect(include.disabled).toBe(false));
    fireEvent.click(include);
    await waitFor(() => expect(select.disabled).toBe(true));
    fireEvent.change(select, { target: { value: runB } });
    await screen.findByText(/Отчёт пересобран/, undefined, { timeout: 5000 });
    expect(track.mock.calls.length).toBeGreaterThan(0);
    expect(track.mock.calls.every((c) => c[0] === runA)).toBe(true);
    expect(within(panel).getByRole("link", { name: /Открыть отчёт проверок/ }).getAttribute("href")).toBe(`/runs/${runA}/checks`);
  }, 10000);
});
