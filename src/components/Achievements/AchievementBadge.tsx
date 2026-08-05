"use client";

import { Box, RingProgress, ThemeIcon, Tooltip } from "@mantine/core";
import type { AchievementView } from "@/lib/achievements";
import { AchIcon } from "./icons";

// Медаль: кольцо прогресса + иконка в центре. Взятая — цветная (бренд) со
// свечением; невзятая — приглушённая (но НЕ мёртво-серая). На кольце прогресс к
// следующей цели; всё взято → полное кольцо. `pulse` — пульс-ринг для «ближайшей
// цели», `fresh` — точка «новое». Press-squish и hover — в .ach-medal (globals).

const SIZES = {
  lg: { ring: 88, thick: 6, icon: 34, iconBox: 48 },
  md: { ring: 60, thick: 5, icon: 26, iconBox: 34 },
  sm: { ring: 52, thick: 4, icon: 22, iconBox: 30 },
} as const;

export default function AchievementBadge({
  a,
  size = "md",
  onClick,
  pulse = false,
  tooltip = true,
}: {
  a: AchievementView;
  size?: keyof typeof SIZES;
  onClick?: () => void;
  pulse?: boolean;
  tooltip?: boolean;
}) {
  const s = SIZES[size];
  const unlocked = a.level > 0;
  const filled = a.maxLevel > 0 ? (a.level + (a.done ? 0 : a.ratio)) / a.maxLevel : 0;
  // Процент заполнения кольца. У взятой медали держим минимум 8%, чтобы дуга
  // читалась; при нуле секцию НЕ рисуем вовсе — иначе roundCap оставляет
  // точку-артефакт на пустой (locked) медали.
  const pct = Math.max(unlocked ? 8 : 0, Math.round(filled * 100));

  const tip = a.done
    ? `${a.title} — всё взято`
    : a.target != null
      ? `${a.title}: ${a.value} / ${a.target}${a.unit ? " " + a.unit : ""}`
      : a.title;

  const medal = (
    <Box
      className={[
        "ach-medal",
        unlocked ? "is-unlocked" : "",
        pulse ? "pulse" : "",
        onClick ? "clickable" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? tip : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <RingProgress
        size={s.ring}
        thickness={s.thick}
        roundCaps
        sections={pct > 0 ? [{ value: pct, color: unlocked ? "brand" : "gray.4" }] : []}
        label={
          <Box style={{ display: "grid", placeItems: "center" }}>
            <ThemeIcon
              size={s.iconBox}
              radius="xl"
              variant={unlocked ? "light" : "default"}
              color={unlocked ? "brand" : "gray"}
              style={{ opacity: unlocked ? 1 : 0.6 }}
            >
              <AchIcon name={a.icon} size={s.icon} />
            </ThemeIcon>
          </Box>
        }
      />
      {a.fresh && <span className="ach-new-dot" aria-label="Новое" />}
    </Box>
  );

  if (!tooltip) return medal;
  return (
    <Tooltip label={tip} withArrow openDelay={200}>
      {medal}
    </Tooltip>
  );
}
