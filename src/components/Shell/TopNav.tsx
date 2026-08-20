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
import { segmentAvailable } from "@/lib/platform";

// Горизонтальное меню над контентом — переключает разделы ТЕКУЩЕГО проекта
// (ссылки /{projectId}/{seg}). На десктопе — полоса вкладок; на мобиле (< sm) —
// dropdown выбора страницы. Новые разделы (adminOnly) для не-админов задизейблены
// («Будет доступно позже»); роуты прикрыты серверным гвардом ((locked)). На /app
// (нет projectId) меню не рендерится.
// ⚠️ Пометок «бета» тут больше нет (убраны по просьбе владельца): для человека это
// рабочие разделы, а значок читался как «сюда пока можно не заходить».
const ITEMS = [
  { label: "Чат", seg: "chat", adminOnly: false },
  { label: "Аналитика", seg: "channel", adminOnly: false },
  { label: "Контент-план", seg: "content-plan", adminOnly: false },
  { label: "Генератор превью", seg: "thumbnails", adminOnly: false },
  // Две разные задачи — два раздела: «Конкуренты» — свой список каналов, за
  // которыми следят постоянно (дёшево: ~2 units на канал), «Поиск референсов» —
  // разовый поиск роликов по нише (дорого: 100 units за запрос).
  { label: "Конкуренты", seg: "competitors", adminOnly: false },
  { label: "Поиск референсов", seg: "references", adminOnly: false },
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
  // Площадка открытого проекта. Список проектов уже в сторе (его тянет AppShell),
  // поэтому лишнего запроса не делаем; пока список не пришёл — считаем YouTube.
  const platform = useAppSelector(
    (st) => st.chat.conversations.find((c) => c.id === projectId)?.platform ?? "youtube"
  );

  // Без проекта (например, /app) переключать нечего.
  if (!projectId) return null;

  // ⚠️ Состав меню зависит от ПЛОЩАДКИ проекта: «Конкуренты» и «Поиск референсов»
  // работают через публичный поиск YouTube, а у Instagram такого API нет вовсе
  // (Graph API отдаёт только свой аккаунт). Показывать их пустыми нельзя — пустой
  // раздел читается как поломка, поэтому убираем из меню (см. segmentAvailable).
  const items = ITEMS.filter((i) => segmentAvailable(platform, i.seg));

  const isActive = (seg: string) => {
    const href = `/${projectId}/${seg}`;
    return pathname === href || pathname.startsWith(href + "/");
  };
  // Активный раздел (для подписи на кнопке dropdown). Фолбэк — Чат.
  const current = items.find((i) => isActive(i.seg)) ?? items[0];

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
          {items.map((item) => {
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
            // Узкая полоса: на телефоне над ней уже есть шапка приложения, и
            // высокий бар съедал ленту сообщений. lineHeight у подписи задан
            // явно — чтобы текст и иконка стояли на одной оптической линии.
            padding: "9px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          {/* Шрифт мельче десктопных вкладок (на телефоне шапка и так плотная),
              но чуть крупнее токена sm — иначе подпись раздела терялась. */}
          <Text fw={600} fz="1rem" truncate lh={1.2}>
            {current.label}
          </Text>
          <IconMenu2
            size={18}
            style={{ flexShrink: 0, display: "block", color: "var(--mantine-color-text)" }}
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
              {items.map((item) => {
                const href = `/${projectId}/${item.seg}`;
                const active = isActive(item.seg);
                const locked = item.adminOnly && !isAdmin;
                const rowBase: React.CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 16px",
                  fontSize: "var(--mantine-font-size-sm)",
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
