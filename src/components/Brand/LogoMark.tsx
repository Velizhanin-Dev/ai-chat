"use client";

import { ThemeIcon } from "@mantine/core";

// Фирменная «марка» — глиф логотипа (public/logo.png) в скруглённом квадрате.
// logo.png монохромный на прозрачном фоне, поэтому красим его через CSS-mask
// по альфа-каналу: цвет глифа задаётся background-color и не зависит от пикселей
// картинки. Так он одинаково чист и белым в оранжевом квадрате, и оранжевым
// в белом (вариант light на акцентной подложке).
export default function LogoMark({
  box = "lg",
  glyph = 22,
  light = false,
}: {
  box?: "md" | "lg";
  glyph?: number;
  light?: boolean;
}) {
  return (
    <ThemeIcon
      size={box}
      radius="md"
      variant={light ? "white" : "gradient"}
      gradient={{ from: "brand.5", to: "brand.7", deg: 135 }}
      color={light ? "brand" : undefined}
    >
      <span
        aria-hidden
        style={{
          width: glyph,
          height: glyph,
          display: "block",
          backgroundColor: light ? "var(--mantine-color-brand-6)" : "#fff",
          WebkitMaskImage: "url(/logo.png)",
          maskImage: "url(/logo.png)",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
          WebkitMaskSize: "contain",
          maskSize: "contain",
        }}
      />
    </ThemeIcon>
  );
}
