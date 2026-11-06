import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../api";
import { Icon } from "../components/Icon";
import { Async, Empty, PageHead, Pager, StatusBadge } from "../components/ui";
import { dateTime, duration } from "../lib/format";
import { useAsync, usePolling } from "../lib/hooks";

export function RunsPage() {
  const api = useApi();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const runs = useAsync(() => api.runs(page, 50), [page]);
  const configs = useAsync(() => api.configurations(1, 200), []);
  const active = !!runs.data?.items.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
  usePolling(() => api.runs(page, 50).then(runs.setData).catch(() => {}), active, 1500);
  const cfgName = (id: string) => configs.data?.items.find((c) => c.id === id)?.name;

  return (
    <>
      <PageHead
        title="Запуски"
        sub="Каждый запуск исполняет конфигурацию на выбранном датасете. Отчёт открывается после публикации."
        actions={
          <Link className="btn btn-primary" to="/configurations">
            <Icon name="play" /> Новый запуск
          </Link>
        }
      />
      <div className="card">
        <Async state={runs} label="Загружаем запуски…">
          {(d) =>
            d.items.length === 0 ? (
              <Empty title="Запусков пока нет">
                Создайте конфигурацию и нажмите «Запустить». <Link to="/configurations/new">Создать конфигурацию</Link>
              </Empty>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>Статус</th>
                        <th>Конфигурация</th>
                        <th>Датасет</th>
                        <th>Создан</th>
                        <th className="num">Длительность</th>
                        <th>Отчёт</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((r) => (
                        <tr key={r.id} className="clickable" onClick={() => nav(`/runs/${encodeURIComponent(r.id)}`)}>
                          <td><StatusBadge status={r.status} /></td>
                          <td>
                            <div style={{ fontWeight: 550 }}>{cfgName(r.configurationId) ?? <span className="muted">—</span>}</div>
                            <div className="muted small mono">{r.id}</div>
                          </td>
                          <td>{r.datasetName}</td>
                          <td className="nowrap">{dateTime(r.createdAt)}</td>
                          <td className="num">{duration(r.startedAt, r.finishedAt)}</td>
                          <td>{r.reportReady ? <span className="badge b-ok">Опубликован</span> : r.status === "FAILED" ? <span className="muted">не опубликован</span> : <span className="muted">ещё нет</span>}</td>
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
