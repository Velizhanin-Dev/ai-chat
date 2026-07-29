"use client";

import { useEffect, useState } from "react";
import { RingProgress, Tooltip } from "@mantine/core";
import { useAppSelector } from "@/store/hooks";
import { fetchPlansView, findUserPlan } from "@/lib/plans-client";

// Кружок остатка квоты запросов в шапке чата (как индикатор использования в
// Claude Code). Заполняется по мере расхода лимита: бирюзовый → жёлтый на
// середине → красный к концу. Тултип: «Запросы: used/X использовано».
//
// Лимит берём по тарифу юзера из GET /api/plans — включая АРХИВНЫЙ тариф (снятый
// с витрины, но действующий у тех, кто его купил; см. findUserPlan);
// израсходованное — из снимка юзера (User.requestsUsed, инкрементится сервером,
// оптимистично — bumpRequestsUsed на клиенте). Для безлимитного тарифа (-1)
// ничего не рисуем. /chat — только для авторизованных (гейтит middleware), так что
// проверка `!user` ниже — лишь null-guard под нуллабельный auth.user, а не сценарий.

export default function RequestsRing() {
  const user = useAppSelector((s) => s.auth.user);
  const [limit, setLimit] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setLimit(null);
      return;
    }
    let active = true;
    fetchPlansView()
      .then((view) => {
        if (!active) return;
        const plan = findUserPlan(view, user.plan);
        setLimit(plan ? plan.limits.requests : null);
      })
      .catch(() => active && setLimit(null));
    return () => {
      active = false;
    };
  }, [user?.id, user?.plan]);

  // Только для конечного лимита (-1 = без лимита, null = тариф не найден → скрыто).
  if (!user || limit == null || limit < 0) return null;

  const used = user.requestsUsed;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  // Жёлтый — на середине, красный — когда заканчивается.
  const color = pct >= 80 ? "red" : pct >= 50 ? "yellow" : "teal";

  return (
    <Tooltip label={`Запросы: ${used}/${limit} использовано`} withArrow openDelay={150}>
      <RingProgress
        size={34}
        thickness={4}
        roundCaps
        sections={[{ value: pct, color }]}
        aria-label={`Запросы: ${used} из ${limit} использовано`}
      />
    </Tooltip>
  );
}
