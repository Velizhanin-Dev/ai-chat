"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  Box,
  Group,
  ScrollArea,
  Tooltip,
  Collapse,
  UnstyledButton,
  Text,
} from "@mantine/core";
import { useDisclosure, useClickOutside } from "@mantine/hooks";
import { IconLock, IconMenu2 } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";

// Горизонтальное меню над контентом — переключает разделы ТЕКУЩЕГО проекта
// (ссылки /{projectId}/{seg}). На десктопе — полоса вкладок; на мобиле (< sm) —
// dropdown выбора страницы. Новые разделы (adminOnly) для не-админов задизейблены
// («Будет доступно позже»); роуты прикрыты серверным гвардом ((locked)). На /app
// (нет projectId) меню не рендерится.
const ITEMS = [
  { label: "Чат", seg: "chat", adminOnly: false },
  { label: "Аналитика", seg: "channel", adminOnly: false },
  { label: "Контент-план", seg: "creatives", adminOnly: true },
  { label: "Генератор превью", seg: "thumbnails", adminOnly: true },
  { label: "Настройки", seg: "settings", adminOnly: false },
] as const;

const TAB_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  whiteSpace: "nowrap",
  padding: "14px 22px",
  fontSize: "var(--mantine-font-size-lg)",
  fontWeight: 600,
  lineHeight: 1.2,
  borderBottom: "3px solid transparent",
  textDecoration: "none",
};

export default function TopNav() {
  const pathname = usePathname();
  const params = useParams();
  const projectId =
    typeof params.projectId === "string" ? params.projectId : null;
  const isAdmin = useAppSelector((s) => s.auth.user?.role) === "admin";
  // Мобильное меню (оверлей во всю ширину) + закрытие по клику вне.
  const [mobileOpen, { toggle: toggleMobile, close: closeMobile }] =
    useDisclosure(false);
  const mobileRef = useClickOutside(() => closeMobile());

  // Без проекта (например, /app) переключать нечего.
  if (!projectId) return null;

  const isActive = (seg: string) => {
    const href = `/${projectId}/${seg}`;
    return pathname === href || pathname.startsWith(href + "/");
  };
  // Активный раздел (для подписи на кнопке dropdown). Фолбэк — Чат.
  const current = ITEMS.find((i) => isActive(i.seg)) ?? ITEMS[0];

  return (
    <Box
      style={{
        flexShrink: 0,
        borderBottom: "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-body)",
      }}
    >
      {/* ── Десктоп/планшет: полоса вкладок ── */}
      <ScrollArea type="never" scrollbars="x" visibleFrom="sm">
        <Group gap={2} wrap="nowrap" px={{ base: "xs", sm: "md" }}>
          {ITEMS.map((item) => {
            const href = `/${projectId}/${item.seg}`;
            const active = isActive(item.seg);
            const locked = item.adminOnly && !isAdmin;

            if (locked) {
              return (
                <Tooltip key={item.seg} label="Будет доступно позже" withArrow>
                  {/* span (не кнопка): disabled-кнопка глотает hover → тултип не
                      срабатывает. Навигации нет, cursor:not-allowed. */}
                  <Box
                    component="span"
                    aria-disabled
                    style={{
                      ...TAB_BASE,
                      color: "var(--mantine-color-dimmed)",
                      opacity: 0.6,
                      cursor: "not-allowed",
                    }}
                  >
                    <IconLock size={16} />
                    {item.label}
                  </Box>
                </Tooltip>
              );
            }

            return (
              <Box
                key={item.seg}
                component={Link}
                href={href}
                style={{
                  ...TAB_BASE,
                  color: active
                    ? "var(--mantine-color-brand-filled)"
                    : "var(--mantine-color-text)",
                  borderBottomColor: active
                    ? "var(--mantine-color-brand-filled)"
                    : "transparent",
                }}
              >
                {item.label}
              </Box>
            );
          })}
        </Group>
      </ScrollArea>

      {/* ── Мобайл (< sm): меню во всю ширину экрана ── */}
      <Box hiddenFrom="sm" ref={mobileRef} style={{ position: "relative" }}>
        <UnstyledButton
          aria-label="Выбрать раздел"
          onClick={toggleMobile}
          style={{
            width: "100%",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Text fw={600} fz="lg" truncate>
            {current.label}
          </Text>
          <IconMenu2
            size={20}
            style={{ flexShrink: 0, color: "var(--mantine-color-text)" }}
          />
        </UnstyledButton>

        {/* Выпадающий список — абсолютным оверлеем во всю ширину полосы (=
            ширина экрана), без скруглений и боковых отступов. */}
        <Box
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
          }}
        >
          <Collapse in={mobileOpen}>
            <Box
              style={{
                background: "var(--mantine-color-body)",
                borderBottom: "1px solid var(--mantine-color-default-border)",
                boxShadow: "var(--mantine-shadow-md)",
              }}
            >
              {ITEMS.map((item) => {
                const href = `/${projectId}/${item.seg}`;
                const active = isActive(item.seg);
                const locked = item.adminOnly && !isAdmin;
                const rowBase: React.CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "14px 16px",
                  fontSize: "var(--mantine-font-size-md)",
                  fontWeight: 500,
                  textDecoration: "none",
                };

                if (locked) {
                  return (
                    <Box
                      key={item.seg}
                      component="span"
                      aria-disabled
                      style={{
                        ...rowBase,
                        justifyContent: "space-between",
                        color: "var(--mantine-color-dimmed)",
                        opacity: 0.6,
                      }}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        <IconLock size={16} />
                        {item.label}
                      </span>
                      <Text component="span" size="xs" c="dimmed">
                        скоро
                      </Text>
                    </Box>
                  );
                }

                return (
                  <Box
                    key={item.seg}
                    component={Link}
                    href={href}
                    onClick={closeMobile}
                    style={{
                      ...rowBase,
                      color: active
                        ? "var(--mantine-color-brand-filled)"
                        : "var(--mantine-color-text)",
                      background: active
                        ? "var(--mantine-color-brand-light)"
                        : "transparent",
                    }}
                  >
                    {item.label}
                  </Box>
                );
              })}
            </Box>
          </Collapse>
        </Box>
      </Box>
    </Box>
  );
}
