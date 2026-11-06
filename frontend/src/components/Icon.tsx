// Небольшой набор линейных иконок 24×24 без внешних зависимостей.
const P: Record<string, string> = {
  runs: "M5 12h3l2-6 4 12 2-6h3",
  config: "M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4",
  play: "M8 5.5v13l11-6.5z",
  plus: "M12 5v14M5 12h14",
  save: "M5 4h11l3 3v13H5zM8 4v5h7M8 20v-6h8v6",
  logout: "M15 17l5-5-5-5M20 12H9M12 20H5V4h7",
  alert: "M12 8v5M12 16.5v.5M10.3 4.2L2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
  info: "M12 11v6M12 7.5v.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M6 11l6-6 6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  ext: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  download: "M12 4v12M7 11l5 5 5-5M5 20h14",
  table: "M3 5h18v14H3zM3 10h18M9 10v9",
  chart: "M5 20V10M12 20V4M19 20v-7",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4",
  filter: "M4 5h16l-6 8v6l-4-2v-4z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
};

export function Icon({ name, size }: { name: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? P.info} fill={name === "play" ? "currentColor" : "none"} />
    </svg>
  );
}
