import type { Page } from "../api/types";

export type AllPages<P> = P & {
  /** false — загрузка остановлена на лимите страниц; items неполные, total из ответа сервера. */
  complete: boolean;
};

/**
 * Загружает все страницы списка (по pageSize, максимум 200 по контракту).
 * Если между страницами сменилась ревизия (отчёт пересобран), загрузка начинается заново.
 */
export async function fetchAllPages<T, P extends Page<T>>(
  get: (page: number, pageSize: number) => Promise<P>,
  opts: { pageSize?: number; maxPages?: number; revision?: (p: P) => unknown } = {},
): Promise<AllPages<P>> {
  const pageSize = opts.pageSize ?? 200;
  const maxPages = opts.maxPages ?? 50;
  for (let attempt = 0; attempt < 3; attempt++) {
    const first = await get(1, pageSize);
    const items = [...first.items];
    const rev = opts.revision?.(first);
    let page = 1;
    let restarted = false;
    while (items.length < first.total && page < maxPages) {
      page++;
      const next = await get(page, pageSize);
      if (opts.revision && opts.revision(next) !== rev) {
        restarted = true;
        break;
      }
      if (next.items.length === 0) break;
      items.push(...next.items);
    }
    if (restarted) continue;
    return { ...first, items, page: 1, pageSize: items.length, complete: items.length >= first.total };
  }
  throw new Error("Отчёт менялся во время загрузки. Обновите страницу.");
}
