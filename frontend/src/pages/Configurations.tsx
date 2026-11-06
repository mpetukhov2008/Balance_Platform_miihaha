import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../api";
import { Icon } from "../components/Icon";
import { Async, Empty, ErrorAlert, PageHead, Pager } from "../components/ui";
import { dateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";

export function ConfigurationsPage() {
  const api = useApi();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const cfgs = useAsync(() => api.configurations(page, 50), [page]);
  const datasets = useAsync(() => api.datasets(), []);
  const [starting, setStarting] = useState<string>();
  const [startError, setStartError] = useState<unknown>();

  async function start(id: string) {
    setStarting(id);
    setStartError(undefined);
    try {
      const r = await api.startRun(id);
      nav(`/runs/${encodeURIComponent(r.id)}`);
    } catch (e) {
      // Повторять POST автоматически нельзя: пользователь видит ошибку и список запусков.
      setStartError(e);
    } finally {
      setStarting(undefined);
    }
  }

  return (
    <>
      <PageHead
        title="Конфигурации"
        sub="Датасет, процедуры нормализации, сравнения и подготовки фактов, набор проверок с параметрами."
        actions={
          <Link className="btn btn-primary" to="/configurations/new">
            <Icon name="plus" /> Новая конфигурация
          </Link>
        }
      />
      {startError !== undefined && (
        <div style={{ marginBottom: 14 }}>
          <ErrorAlert error={startError} />
          <div className="muted small" style={{ marginTop: 6 }}>
            Запуск мог быть создан — проверьте <Link to="/runs">список запусков</Link> перед повтором.
          </div>
        </div>
      )}
      <div className="card">
        <Async state={cfgs}>
          {(d) =>
            d.items.length === 0 ? (
              <Empty title="Конфигураций пока нет" icon="config">
                <Link to="/configurations/new">Создайте первую</Link> — по умолчанию подставляются встроенные процедуры и выданные проверки.
              </Empty>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Название</th>
                        <th>Датасет</th>
                        <th className="num">Проверок</th>
                        <th>ИИ</th>
                        <th>Изменена</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <Link to={`/configurations/${encodeURIComponent(c.id)}`} style={{ fontWeight: 600 }}>{c.name}</Link>
                          </td>
                          <td>{datasets.data?.items.find((x) => x.id === c.datasetId)?.name ?? c.datasetId}</td>
                          <td className="num">{c.checks.length}</td>
                          <td>{c.aiReviewEnabled ? <span className="badge b-info">вкл.</span> : <span className="muted">выкл.</span>}</td>
                          <td className="nowrap">{dateTime(c.updatedAt)}</td>
                          <td style={{ textAlign: "right" }}>
                            <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                              <Link className="btn btn-sm" to={`/configurations/${encodeURIComponent(c.id)}`}>Изменить</Link>
                              <button className="btn btn-sm btn-primary" disabled={!!starting} onClick={() => start(c.id)}>
                                <Icon name="play" /> {starting === c.id ? "Запускаем…" : "Запустить"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
              </>
            )
          }
        </Async>
      </div>
    </>
  );
}
