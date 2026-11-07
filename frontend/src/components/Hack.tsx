import type { ReactNode } from "react";

export const HACK = {
  name: "Nuclear IT Hack",
  dates: "6–8 ноября 2026",
  url: "https://nuclearhack.mephi.ru/",
  team: "МИЯУХАХА",
};

/** Плашка в угловых скобках: [ ТЕКСТ ]. */
export function Bracket({ children, accent, small, href }: { children: ReactNode; accent?: boolean; small?: boolean; href?: string }) {
  const cls = `bracket ${accent ? "accent" : ""} ${small ? "sm" : ""}`;
  return href ? (
    <a className={cls} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span className={cls}>{children}</span>
  );
}

/** Пометка проекта хакатона для шапки. */
export function HackChip() {
  return (
    <Bracket small href={HACK.url}>
      <span className="hack-chip">
        <b>●</b> {HACK.name}
      </span>
    </Bracket>
  );
}

/** Оранжевая «планета» с вращающейся орбитальной надписью. */
export function Orbit() {
  const text = `BALANCE PLATFORM · ${HACK.name.toUpperCase()} · CODING WITH CLARITY · `;
  return (
    <svg className="orbit" viewBox="0 0 560 560" aria-hidden="true">
      <defs>
        <radialGradient id="bp-planet" cx="38%" cy="34%" r="70%">
          <stop offset="0%" stopColor="#f3b79c" />
          <stop offset="28%" stopColor="#d97757" />
          <stop offset="62%" stopColor="#6b2d17" />
          <stop offset="100%" stopColor="#120806" />
        </radialGradient>
        <path id="bp-orbit-path" d="M280,280 m-238,0 a238,238 0 1,1 476,0 a238,238 0 1,1 -476,0" />
      </defs>
      <circle className="planet" cx="280" cy="280" r="190" />
      <circle cx="280" cy="280" r="190" fill="none" stroke="rgba(255,255,255,.08)" />
      <g className="spin">
        <text className="ring-text">
          <textPath href="#bp-orbit-path">{text.repeat(2)}</textPath>
        </text>
      </g>
    </svg>
  );
}

/** Подвал приложения: команда и хакатон, с крупным контурным текстом. */
export function AppFooter() {
  return (
    <footer className="app-foot">
      <div className="ghost-text" aria-hidden="true">Nuclear IT Hack</div>
      <div className="app-foot-in">
        <span>
          Balance Platform — проект команды <b style={{ color: "#fff" }}>{HACK.team}</b> для хакатона{" "}
          <a href={HACK.url} target="_blank" rel="noopener noreferrer">
            {HACK.name}
          </a>
        </span>
        <span className="row" style={{ gap: 10 }}>
          <Bracket small>{HACK.dates}</Bracket>
          <Bracket small>онлайн / офлайн</Bracket>
        </span>
      </div>
    </footer>
  );
}
