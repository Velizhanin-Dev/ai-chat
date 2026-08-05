"use client";

import Link from "next/link";
import { Group, Text } from "@mantine/core";
import LogoMark from "./LogoMark";

// Единый логотип бренда для лендинга и шапки приложения.
// Кликабельный целиком (иконка + текст) — по умолчанию ведёт на главную (/).
// Типографика совпадает с лендингом: Text fw 600, отрицательный трекинг,
// неразрывный пробел в названии.
export default function Logo({
  href = "/",
  onClick,
  iconOnly = false,
}: {
  href?: string;
  onClick?: () => void;
  // Только знак-логотип, без текста «VELIZHANIN AI» (используем в мобильной
  // шапке, где рядом со знаком показываем название текущего проекта).
  iconOnly?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{ textDecoration: "none", color: "inherit" }}
      aria-label="VELIZHANIN AI — на главную"
    >
      <Group gap="xs" wrap="nowrap">
        <LogoMark box="lg" glyph={32} />
        {!iconOnly && (
          <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
            VELIZHANIN&nbsp;AI
          </Text>
        )}
      </Group>
    </Link>
  );
}
