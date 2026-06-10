"use client";

import Link from "next/link";
import { Group, Text, ThemeIcon } from "@mantine/core";
import { IconBrain } from "@tabler/icons-react";

// Единый логотип бренда для лендинга и шапки приложения.
// Кликабельный (по умолчанию ведёт на /), типографика совпадает с лендингом:
// Text fw 600, отрицательный трекинг, неразрывный пробел в названии.
export default function Logo({
  href = "/",
  onClick,
}: {
  href?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      style={{ textDecoration: "none", color: "inherit" }}
      aria-label="VELIZHANIN AI — на главную"
    >
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon
          size="lg"
          radius="md"
          variant="gradient"
          gradient={{ from: "brand.5", to: "brand.7", deg: 135 }}
        >
          <IconBrain size={22} />
        </ThemeIcon>
        <Text fw={600} fz="lg" style={{ letterSpacing: "-0.02em" }}>
          VELIZHANIN&nbsp;AI
        </Text>
      </Group>
    </Link>
  );
}
