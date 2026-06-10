"use client";

import Link from "next/link";
import { Group, Text, ThemeIcon } from "@mantine/core";
import { IconBrain } from "@tabler/icons-react";

/** Логотип бренда. На тёмной/акцентной подложке передать light. */
export default function BrandMark({
  light = false,
  size = "lg",
}: {
  light?: boolean;
  size?: "sm" | "lg";
}) {
  const fz = size === "sm" ? "md" : "lg";
  const iconSize = size === "sm" ? 18 : 22;

  return (
    <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon
          size={size === "sm" ? "md" : "lg"}
          radius="md"
          variant={light ? "white" : "gradient"}
          gradient={{ from: "brand.5", to: "brand.7", deg: 135 }}
          color={light ? "brand" : undefined}
        >
          <IconBrain size={iconSize} />
        </ThemeIcon>
        <Text
          fw={600}
          fz={fz}
          style={{ letterSpacing: "-0.02em", color: light ? "#fff" : undefined }}
        >
          VELIZHANIN&nbsp;AI
        </Text>
      </Group>
    </Link>
  );
}
