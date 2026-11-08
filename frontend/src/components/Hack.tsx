import type { ReactNode } from "react";
import { Mars } from "./Mars";
import { BRAND, SUPPORT } from "../lib/brand";

export const HACK = {
  name: "Nuclear IT Hack",
  dates: "6–8 ноября 2026",
  url: "https://nuclearhack.mephi.ru/",
  team: "МИЯУХАХА",
};

/** Техподдержка 24/7: несколько контактов в Telegram. */
export function SupportLink() {
  return (
    <span className="support-link">
      <span className="support-dot" aria-hidden="true" /> Техподдержка 24/7 в Telegram:
      {SUPPORT.map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">
          {s.handle}
        </a>
      ))}
    </span>
  );
}

/** Крупный контурный заголовок, всегда растянутый ровно на ширину контейнера. */
export function GhostTitle({ text, className }: { text: string; className?: string }) {
  return (
    <svg className={`ghost-svg ${className ?? ""}`} viewBox="0 0 1000 118" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <text x="0" y="104" textLength="1000" lengthAdjust="spacingAndGlyphs">
        {text.toUpperCase()}
      </text>
    </svg>
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
  const text = `${BRAND.ring} · ${HACK.name.toUpperCase()} · АНАЛИЗ ИЗМЕНЕНИЙ · `;
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
      <GhostTitle text={HACK.name} className="foot-ghost" />
      <div className="app-foot-in">
        <span className="foot-about">
          Сайт для <b style={{ color: "#fff" }}>{BRAND.name}</b> сделала студенческая команда {HACK.team} на хакатоне{" "}
          <a href={HACK.url} target="_blank" rel="noopener noreferrer">
            {HACK.name}
          </a>
          . Команда не является сотрудниками компании.
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
