import type { ReactNode } from "react";
import { Mars } from "./Mars";

export const HACK = {
  name: "Nuclear IT Hack",
  dates: "6–8 ноября 2026",
  url: "https://nuclearhack.mephi.ru/",
  team: "МИЯУХАХА",
};

export const SUPPORT = { url: "https://t.me/m_petukhov_2008", handle: "@m_petukhov_2008" };

/** Ссылка на техподдержку в Telegram. */
export function SupportLink() {
  return (
    <a className="support-link" href={SUPPORT.url} target="_blank" rel="noopener noreferrer">
      <span className="support-dot" aria-hidden="true" /> Техподдержка 24/7 · Telegram {SUPPORT.handle}
    </a>
  );
}

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

/** Вращающийся Марс с орбитальной надписью. */
export function Orbit() {
  const text = `BALANCE PLATFORM · ${HACK.name.toUpperCase()} · CODING WITH CLARITY · `;
  return (
    <div className="orbit" aria-hidden="true">
      <Mars size={360} />
      <svg viewBox="0 0 560 560">
        <defs>
          <path id="bp-orbit-path" d="M280,280 m-238,0 a238,238 0 1,1 476,0 a238,238 0 1,1 -476,0" />
        </defs>
        <g className="spin">
          <text className="ring-text">
            <textPath href="#bp-orbit-path">{text.repeat(2)}</textPath>
          </text>
        </g>
      </svg>
    </div>
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
        <SupportLink />
        <span className="row" style={{ gap: 10 }}>
          <Bracket small>{HACK.dates}</Bracket>
          <Bracket small>онлайн / офлайн</Bracket>
        </span>
      </div>
    </footer>
  );
}
