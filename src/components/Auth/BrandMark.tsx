"use client";

import Link from "next/link";
import { Group, Text } from "@mantine/core";
import LogoMark from "@/components/Brand/LogoMark";

/** Логотип бренда. На тёмной/акцентной подложке передать light. */
export default function BrandMark({
  light = false,
  size = "lg",
}: {
  light?: boolean;
  size?: "sm" | "lg";
}) {
  const fz = size === "sm" ? "md" : "lg";
  const glyph = size === "sm" ? 18 : 22;

  return (
    <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
      <Group gap="xs" wrap="nowrap">
        <LogoMark box={size === "sm" ? "md" : "lg"} glyph={glyph} light={light} />
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
