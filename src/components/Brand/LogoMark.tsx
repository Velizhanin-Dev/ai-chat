"use client";

/* eslint-disable @next/next/no-img-element -- статичные ассеты из /public, оптимизатор
   next/image в проде недоступен (sharp); обычный <img> здесь правильнее. */

// Фирменная «марка» — глиф логотипа БЕЗ оранжевой подложки. Лого монохромное с
// прозрачным фоном и «выемкой»-плеем, поэтому не перекрашиваем CSS-маской (она бы
// съела выемку), а берём готовые файлы 512×512:
//   • тёмная тема → белое лого (android-chrome-512x512-white.png);
//   • светлая тема → чёрное лого (android-chrome-512x512.png).
// Переключение — чистым CSS по `data-mantine-color-scheme` (Mantine ставит его до
// отрисовки → без мигания и hydration-mismatch). light=true — принудительно белое
// (для тёмной/акцентной подложки, напр. auth-панель).

const SRC_LIGHT = "/android-chrome-512x512.png"; // чёрное — для светлой темы
const SRC_DARK = "/android-chrome-512x512-white.png"; // белое — для тёмной темы

export default function LogoMark({
  box = "lg",
  glyph,
  light = false,
}: {
  box?: "md" | "lg";
  glyph?: number;
  light?: boolean;
}) {
  const size = glyph ?? (box === "lg" ? 26 : 22);

  if (light) {
    return (
      <img src={SRC_DARK} alt="" aria-hidden width={size} height={size} style={{ display: "block" }} />
    );
  }

  return (
    <span style={{ display: "inline-flex", width: size, height: size, lineHeight: 0 }}>
      <img src={SRC_LIGHT} alt="" aria-hidden width={size} height={size} className="lm-light" />
      <img src={SRC_DARK} alt="" aria-hidden width={size} height={size} className="lm-dark" />
    </span>
  );
}
