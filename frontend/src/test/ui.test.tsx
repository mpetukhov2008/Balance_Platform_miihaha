import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "../api";
import { SideValue } from "../components/Value";
import type { ComparisonRow } from "../api/types";
import { readyMock, renderRun } from "./utils";

describe("Сводная", () => {
  it("изменение раскладки меняет запрос к серверу", async () => {
    const { api, runId } = await readyMock();
    const spy = vi.spyOn(api, "pivot");
    renderRun(api, `/runs/${runId}/pivot`);
    await screen.findByTestId("pivot-table");
    const first = spy.mock.calls.find((c) => c[1].rows.length === 4)![1];
    expect(first.rows).toEqual(["PREFIX", "CLASS", "SUFFIX", "KEY"]);
    expect(first.columns).toEqual(["DIFF_FLAG", "SOURCE"]);

    // Перенос KEY в колонки и подъём CLASS.
    fireEvent.click(screen.getByLabelText("Перенести KEY"));
    fireEvent.click(screen.getByLabelText("Поднять CLASS"));
    await waitFor(() => {
      const last = spy.mock.calls[spy.mock.calls.length - 1][1];
      expect(last.rows).toEqual(["CLASS", "PREFIX", "SUFFIX"]);
      expect(last.columns).toEqual(["DIFF_FLAG", "SOURCE", "KEY"]);
    });
  });

  it("клик по ячейке передаёт token и сохраняет контекст фильтра", async () => {
    const { api, runId } = await readyMock();
    const appsSpy = vi.spyOn(api, "applications");
    renderRun(api, `/runs/${runId}/pivot?rows=KEY&cols=SOURCE&f=${encodeURIComponent(JSON.stringify([{ field: "CHANGE_TYPE", op: "eq", value: "ATTRIBUTE_LOST" }]))}`);
    const table = await screen.findByTestId("pivot-table");
    const cell = within(table).getAllByRole("button")[0];
    fireEvent.click(cell);
    await screen.findByText(/Группа сводной/);
    expect(screen.getByText(/CHANGE_TYPE eq ATTRIBUTE_LOST/)).toBeTruthy();
    const q = appsSpy.mock.calls[0][1];
    expect(q.drilldownToken).toBeTruthy();
    expect(q.checkRowId).toBeUndefined();
    await screen.findByText(/^DEMO-000\d$/);
  });
});

describe("Заявка и атрибут", () => {
  it("переход к атрибуту выделяет именно его (PATH + ARRAY_KEY)", async () => {
    const { api, runId } = await readyMock();
    const path = "decisionResult.product_trials.rules.hit";
    renderRun(api, `/runs/${runId}/apps/DEMO-0002?path=${encodeURIComponent(path)}&arrayKey=${encodeURIComponent("751|STOP_FRAUD")}`);
    const detail = await screen.findByTestId("attribute-detail");
    expect(within(detail).getByText(path)).toBeTruthy();
    expect(within(detail).getByText("751|STOP_FRAUD")).toBeTruthy();
    expect(within(detail).getByText("ATTRIBUTE_LOST")).toBeTruthy();
    // AFTER отсутствует — показано как «отсутствует», а не пустая строка.
    expect(within(detail).getAllByText("отсутствует").length).toBeGreaterThan(0);
  });
});

describe("Отчёт проверок", () => {
  it("CNT больше APP_IDS: подпись «показано N из CNT», LOW бледно", async () => {
    const { api, runId } = await readyMock();
    renderRun(api, `/runs/${runId}/checks`);
    const table = await screen.findByTestId("checks-table");
    expect(within(table).getByText("показано 2 из 12")).toBeTruthy();
    const lowRow = within(table).getByText("STOP_FRAUD").closest("tr")!;
    expect(lowRow.className).toContain("low");
    // Строковая METRIC выводится как есть, без процентов.
    expect(within(table).getByText("−50 п.п.")).toBeTruthy();
  });

  it("добавление проверки отправляется на сервер и обновляет отчёт", async () => {
    const { api, runId } = await readyMock();
    const s = await api.createScript({ name: "Моя проверка", kind: "CHECK", sourceType: "WORKSPACE", code: 'CHECK = {"id": "mine"}', params: {}, contractId: "check-v1" });
    const exec = vi.spyOn(api, "executeCheck");
    renderRun(api, `/runs/${runId}/checks`);
    await screen.findByTestId("checks-table");
    const panel = await screen.findByTestId("add-check");
    await waitFor(() => expect((within(panel).getByRole("combobox") as HTMLSelectElement).value).toBe(s.id));
    fireEvent.click(within(panel).getByText(/Выполнить и добавить в отчёт/));
    await waitFor(() => expect(exec).toHaveBeenCalledWith(runId, { scriptId: s.id, params: {} }));
    await screen.findByText(/ревизия 2/, undefined, { timeout: 5000 });
    await waitFor(() => expect(within(screen.getByTestId("checks-table")).getByText("Моя проверка")).toBeTruthy());
  }, 10000);

  it("ошибка выполнения Python показывается как ошибка, а не PASS", async () => {
    const { api, runId } = await readyMock();
    const s = await api.createScript({ name: "Сломанная", kind: "CHECK", sourceType: "WORKSPACE", code: "raise ValueError()", params: {}, contractId: "check-v1" });
    renderRun(api, `/runs/${runId}/checks`);
    const panel = await screen.findByTestId("add-check");
    await waitFor(() => expect((within(panel).getByRole("combobox") as HTMLSelectElement).value).toBe(s.id));
    fireEvent.click(within(panel).getByText(/Выполнить и добавить в отчёт/));
    await screen.findByText(/Ошибка исполнения проверки/, undefined, { timeout: 5000 });
    expect(within(screen.getByTestId("checks-table")).queryByText("Сломанная")).toBeNull();
  }, 10000);
});

describe("Ошибки и пустые значения", () => {
  it("ошибка сервера в сводке не показывается как успешный ноль", async () => {
    const { api, runId } = await readyMock();
    vi.spyOn(api, "summary").mockRejectedValue(new ApiError(503, "EXECUTOR_UNAVAILABLE", "Исполнитель недоступен"));
    renderRun(api, `/runs/${runId}/summary`);
    await screen.findByText("Ошибка сервера");
    expect(screen.getByText("Исполнитель недоступен")).toBeTruthy();
    expect(screen.queryByText("Всего заявок")).toBeNull();
  });

  it("null в KPI — «нет данных», 0 — это 0", async () => {
    const { api, runId } = await readyMock();
    const real = await api.summary(runId);
    vi.spyOn(api, "summary").mockResolvedValue({ ...real, changedApps: 0, externalDriftDecisionApps: null });
    renderRun(api, `/runs/${runId}/summary`);
    await screen.findByText("Всего заявок");
    expect(screen.getByText("нет данных")).toBeTruthy();
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("различает null, false, 0, пустую строку и отсутствие", () => {
    const base = { APP_ID: "A", PREFIX: "p", CLASS: "", SUFFIX: "", ARRAY_KEY: "", KEY: "k", PATH: "p.k", ADJUSTED_BEFORE: "", ADJUSTED_AFTER: "", DIFF_FLAG: 1 } as const;
    const cases: [Partial<ComparisonRow>, string][] = [
      [{ VALUE_BEFORE: "", VALUE_AFTER: "", CHANGE_TYPE: "VALUE_CHANGED", valueTypeBefore: "NoneType", valueTypeAfter: "str" }, "null"],
      [{ VALUE_BEFORE: "False", VALUE_AFTER: "", CHANGE_TYPE: "VALUE_CHANGED", valueTypeBefore: "bool" }, "False"],
      [{ VALUE_BEFORE: "0", VALUE_AFTER: "", CHANGE_TYPE: "VALUE_CHANGED", valueTypeBefore: "int" }, "0"],
      [{ VALUE_BEFORE: "", VALUE_AFTER: "", CHANGE_TYPE: "VALUE_CHANGED", valueTypeBefore: "str" }, "«» пустая строка"],
      [{ VALUE_BEFORE: "", VALUE_AFTER: "x", CHANGE_TYPE: "ATTRIBUTE_NEW" }, "отсутствует"],
    ];
    for (const [c, text] of cases) {
      const { unmount } = render(<SideValue row={{ ...base, ...c } as ComparisonRow} side="BEFORE" />);
      expect(screen.getByText(text)).toBeTruthy();
      unmount();
    }
  });
});
