import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = { data: T | undefined; error: unknown; loading: boolean; reload: () => void; setData: (d: T) => void };

/** Загрузка с отменой устаревших ответов; ошибка не превращается в пустой успешный результат. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    const my = ++seq.current;
    setLoading(true);
    setError(undefined);
    fn().then(
      (d) => my === seq.current && (setData(d), setLoading(false)),
      (e) => my === seq.current && (setError(e), setData(undefined), setLoading(false)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Опрос раз в interval мс, пока active; останавливается при размонтировании. */
export function usePolling(cb: () => Promise<unknown> | void, active: boolean, interval = 1000) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      try {
        await ref.current();
      } finally {
        if (!stop) timer = setTimeout(loop, interval);
      }
    };
    timer = setTimeout(loop, interval);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [active, interval]);
}

/**
 * Отслеживание задачи до завершения. Временные ошибки опроса (сеть, 500/503) не обрывают
 * отслеживание: показываем предупреждение и продолжаем; сдаёмся после maxFailures подряд.
 */
export function useTrackedJob<T extends { status: string }>(fetcher: ((id: string) => Promise<T>) | null, id: string | undefined, onDone?: (j: T) => void, maxFailures = 10) {
  const [job, setJob] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [gaveUp, setGaveUp] = useState(false);
  const fails = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    setJob(undefined);
    setError(undefined);
    setGaveUp(false);
    fails.current = 0;
  }, [id]);
  const active = !!id && !!fetcher && !gaveUp && (!job || job.status === "QUEUED" || job.status === "RUNNING");
  usePolling(async () => {
    try {
      const j = await fetcher!(id!);
      fails.current = 0;
      setError(undefined);
      setJob(j);
      if (j.status === "SUCCEEDED" || j.status === "FAILED") doneRef.current?.(j);
    } catch (e) {
      setError(e);
      if (++fails.current >= maxFailures) setGaveUp(true);
    }
  }, active, 1000);
  return { job, error, gaveUp, active };
}
