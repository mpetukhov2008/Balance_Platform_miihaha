import { useEffect, useRef } from "react";

const TW = 768; // ширина текстуры (долгота)
const TH = 384; // высота текстуры (широта)

/** Детерминированный хеш решётки → [0, 1). */
function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value-noise, периодичный по x: текстура бесшовно повторяется по долготе. */
function noise(u: number, v: number, f: number, seed: number) {
  const x = u * f, y = v * f;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const sx = x - x0, sy = y - y0;
  const fx = sx * sx * (3 - 2 * sx), fy = sy * sy * (3 - 2 * sy);
  const w = (i: number) => ((i % f) + f) % f;
  const a = hash(w(x0), y0, seed), b = hash(w(x0 + 1), y0, seed);
  const c = hash(w(x0), y0 + 1, seed), d = hash(w(x0 + 1), y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(u: number, v: number, base: number, octaves: number, seed: number) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = base << o;
    sum += amp * noise(u, v, f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Процедурная текстура Марса в равнопромежуточной проекции (RGB). */
function marsTexture() {
  const f = new Float32Array(TW * TH * 3);
  for (let y = 0; y < TH; y++) {
    const v = y / TH;
    const lat = Math.abs(v - 0.5) * 2; // 0 — экватор, 1 — полюс
    for (let x = 0; x < TW; x++) {
      const u = x / TW;
      const n = fbm(u, v, 6, 7, 1); // рельеф и оттенок почвы
      const fine = fbm(u, v, 48, 3, 5); // мелкая зернистость
      const albedo = fbm(u, v, 3, 5, 7); // крупные тёмные области
      // Базовый тон: от ржаво-красного к светлой охре
      const t = smooth(0.3, 0.72, n);
      let r = mix(150, 214, t), g = mix(64, 128, t), b = mix(32, 78, t);
      // Тёмные «моря» с рваными краями
      const dk = smooth(0.47, 0.58, albedo + (n - 0.5) * 0.22) * 0.9;
      r = mix(r, 62, dk); g = mix(g, 28, dk); b = mix(b, 17, dk);
      // Пылевые светлые поля
      const ds = smooth(0.6, 0.78, fbm(u, v, 4, 4, 41)) * 0.4 * (1 - dk);
      r = mix(r, 236, ds); g = mix(g, 176, ds); b = mix(b, 130, ds);
      const gr = (fine - 0.5) * 26;
      r += gr; g += gr * 0.75; b += gr * 0.55;
      // Полярные шапки с неровным краем
      const cap = smooth(0.82, 0.9, lat + (fbm(u, v, 10, 3, 61) - 0.5) * 0.14);
      r = mix(r, 240, cap); g = mix(g, 234, cap); b = mix(b, 228, cap);
      const i = (y * TW + x) * 3;
      f[i] = r; f[i + 1] = g; f[i + 2] = b;
    }
  }
  // Кратеры: тёмная чаша и освещённый вал (свет сверху-слева)
  for (let k = 0; k < 90; k++) {
    const cu = hash(k, 1, 91), cv = 0.12 + hash(k, 2, 91) * 0.76;
    const rad = 1.5 + Math.pow(hash(k, 3, 91), 4) * 11;
    const cx = cu * TW, cy = cv * TH;
    const stretch = 1 / Math.max(0.25, Math.cos((cv - 0.5) * Math.PI));
    const rx = rad * stretch * 1.25;
    for (let y = Math.max(0, Math.floor(cy - rad * 1.3)); y < Math.min(TH, cy + rad * 1.3); y++) {
      for (let dx = -Math.ceil(rx * 1.3); dx <= Math.ceil(rx * 1.3); dx++) {
        const ddx = dx / rx, ddy = (y - cy) / rad;
        const d = Math.hypot(ddx, ddy);
        if (d > 1.25) continue;
        const x = (((Math.floor(cx) + dx) % TW) + TW) % TW;
        const i = (y * TW + x) * 3;
        let m = 1;
        if (d < 0.85) m = 0.9 + 0.06 * d + (ddx + ddy < 0 ? -0.05 : 0.02); // чаша: затенённая стена к свету
        else if (d < 1.15) m = 1 + 0.08 * (1 - Math.abs(d - 1) / 0.15) * (ddx + ddy < 0 ? 1 : 0.4); // освещённый вал
        f[i] *= m; f[i + 1] *= m; f[i + 2] *= m;
      }
    }
  }
  const tex = new Uint8ClampedArray(TW * TH * 3);
  tex.set(f);
  return tex;
}

let cached: Uint8ClampedArray | null = null;

/**
 * Вращающийся Марс: процедурная текстура натягивается на сферу,
 * освещение сверху-слева, затемнение к краю и атмосферная дымка.
 */
export function Mars({ size = 300, period = 90 }: { size?: number; period?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext?.("2d");
    if (!canvas || !ctx) return; // нет canvas (тесты) — просто пустой блок
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = Math.round(size * dpr);
    canvas.width = S;
    canvas.height = S;
    const tex = (cached ??= marsTexture());
    const img = ctx.createImageData(S, S);
    const R = S / 2 - 2 * dpr;
    const c = S / 2;
    const tilt = (-18 * Math.PI) / 180; // наклон оси
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const L = [-0.78, -0.36, 0.52];
    const ln = Math.hypot(L[0], L[1], L[2]);
    // Предрасчёт для каждого пикселя диска: долгота, строка текстуры, освещённость
    const idx: number[] = [], u0: number[] = [], row: number[] = [], shade: number[] = [], alpha: number[] = [], haze: number[] = [];
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = (px + 0.5 - c) / R, y = (py + 0.5 - c) / R;
        const d2 = x * x + y * y;
        if (d2 > 1) continue;
        const z = Math.sqrt(1 - d2);
        const xr = x * ct - y * st, yr = x * st + y * ct;
        const lat = Math.asin(yr);
        const lon = Math.atan2(xr, z);
        const diff = Math.max(0, (x * L[0] + y * L[1] + z * L[2]) / ln);
        const edge = Math.min(1, (1 - Math.sqrt(d2)) * R / dpr / 1.2); // сглаживание края
        idx.push((py * S + px) * 4);
        u0.push(((lon / (2 * Math.PI) + 0.5) * TW));
        row.push(Math.min(TH - 1, Math.max(0, Math.floor((lat / Math.PI + 0.5) * TH))) * TW);
        shade.push((0.02 + 1.12 * Math.pow(diff, 1.1)) * (0.86 + 0.14 * z));
        alpha.push(255 * edge);
        // Атмосфера: тёплая дымка только у освещённого края
        const lit = Math.max(0, (x * L[0] + y * L[1] + z * L[2]) / ln + 0.2);
        haze.push(Math.pow(1 - z, 2.4) * lit * 150);
      }
    }
    const data = img.data;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, last = 0;
    const draw = (t: number) => {
      const off = reduce ? 0 : ((t / 1000) * TW) / period;
      for (let k = 0; k < idx.length; k++) {
        let u = (u0[k] + off) % TW;
        if (u < 0) u += TW;
        const ti = (row[k] + (u | 0)) * 3;
        const s = shade[k];
        const o = idx[k];
        const h = haze[k];
        data[o] = tex[ti] * s + h;
        data[o + 1] = tex[ti + 1] * s + h * 0.62;
        data[o + 2] = tex[ti + 2] * s + h * 0.42;
        data[o + 3] = alpha[k];
      }
      ctx.putImageData(img, 0, 0);
    };
    const loop = (t: number) => {
      if (t - last > 33) {
        last = t;
        draw(t);
      }
      raf = requestAnimationFrame(loop);
    };
    draw(0);
    if (!reduce) raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size, period]);

  return <canvas ref={ref} className="mars" style={{ width: size, height: size }} aria-hidden="true" />;
}
