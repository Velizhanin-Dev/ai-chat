"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Breadcrumbs, Anchor, Text } from "@mantine/core";

// Хлебные крошки для /legal/*: «Главная → <текущий документ>». Метку берём по
// текущему пути (клиентский usePathname) — поэтому крошки живут в layout и не
// дублируются в каждой странице.
const LABELS: Record<string, string> = {
  "/legal/terms": "Пользовательское соглашение",
  "/legal/privacy": "Политика конфиденциальности",
};

export default function LegalBreadcrumbs() {
  const pathname = usePathname();
  const label = LABELS[pathname];
  if (!label) return null;

  return (
    <Breadcrumbs separator="→" fz="sm" mb="lg">
      <Anchor component={Link} href="/" c="dimmed" underline="hover">
        Главная
      </Anchor>
      <Text c="dimmed">{label}</Text>
    </Breadcrumbs>
  );
}
