import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiContext } from "../api";
import { MockApiClient } from "../api/mock";
import { RunPage } from "../pages/run/RunPage";

/** Демо-клиент с завершённым запуском; используется только в тестах UI. */
export async function readyMock() {
  const api = new MockApiClient();
  await api.login("tester", "x");
  const cfg = await api.createConfiguration({
    name: "t", datasetId: "demo", aiReviewEnabled: true, checks: [],
    normalizer: { scriptId: "builtin-normalize", params: {} },
    comparator: { scriptId: "builtin-compare", params: {} },
    aggregator: { scriptId: "builtin-aggregate", params: {} },
  });
  const { id } = await api.startRun(cfg.id);
  for (let i = 0; i < 30 && !(await api.run(id)).reportReady; i++);
  return { api, runId: id };
}

export function renderRun(api: MockApiClient, path: string) {
  return render(
    <ApiContext.Provider value={api}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/runs/:runId/*" element={<RunPage />} />
        </Routes>
      </MemoryRouter>
    </ApiContext.Provider>,
  );
}
