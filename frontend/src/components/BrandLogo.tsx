/**
 * Логотип Balance Platform: две строки одной ширины и акцентная полоса под ними.
 * Векторный, текст наследует currentColor, полоса — цвет акцента темы.
 */
export function BrandLogo({ height = 40, title = "Balance Platform" }: { height?: number; title?: string }) {
  return (
    <svg className="brand-logo" viewBox="0 0 200 92" height={height} width={(height * 200) / 92} role="img" aria-label={title}>
      <title>{title}</title>
      <g fill="currentColor" fontFamily="var(--font)" fontWeight={800} fontSize={36}>
        <text x="0" y="31" textLength="200" lengthAdjust="spacingAndGlyphs">BALANCE</text>
        <text x="0" y="67" textLength="200" lengthAdjust="spacingAndGlyphs">PLATFORM</text>
      </g>
      <rect x="0" y="77" width="200" height="15" fill="var(--accent)" />
    </svg>
  );
}
