"use client";

import Link from "next/link";
import { Group, Text } from "@mantine/core";
import LogoMark from "./LogoMark";

// Единый логотип бренда для лендинга и шапки приложения.
// Кликабельный (по умолчанию ведёт на /), типографика совпадает с лендингом:
// Text fw 600, отрицательный трекинг, неразрывный пробел в названии.
export default function Logo({
  href = "/",
  markHref,
  textHref,
  onClick,
}: {
  href?: string;
  // Раздельные ссылки: иконка и текст ведут в разные места. В шапке /chat
  // иконка → главная (markHref="/"), текст → чат (textHref="/chat").
  markHref?: string;
  textHref?: string;
  onClick?: () => void;
}) {
  const text = (
    <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
      VELIZHANIN&nbsp;AI
    </Text>
  );

  // Режим раздельных ссылок.
  if (markHref || textHref) {
    return (
      <Group gap="xs" wrap="nowrap">
        <Link
          href={markHref ?? href}
          onClick={onClick}
          style={{ display: "inline-flex", textDecoration: "none", color: "inherit" }}
          aria-label="VELIZHANIN AI — на главную"
        >
          <LogoMark box="lg" glyph={22} />
        </Link>
        <Link
          href={textHref ?? href}
          onClick={onClick}
          style={{ textDecoration: "none", color: "inherit" }}
          aria-label="VELIZHANIN AI — в чат"
        >
          {text}
        </Link>
      </Group>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      style={{ textDecoration: "none", color: "inherit" }}
      aria-label="VELIZHANIN AI — на главную"
    >
      <Group gap="xs" wrap="nowrap">
        <LogoMark box="lg" glyph={22} />
        {text}
      </Group>
    </Link>
  );
}
