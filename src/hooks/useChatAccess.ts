"use client";

import { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { fetchPlansView, findUserPlan } from "@/lib/plans-client";

// Доступ к чату на клиенте: повторяет серверный гейт (/api/chat) для UX —
// заблокировать ввод и показать модалку с тарифами. Истина всё равно на сервере
// (403 PLAN_EXPIRED / QUOTA_EXCEEDED), здесь — только отражение состояния.
//
// reason: expired — срок тарифа вышел; quota — запросы кончились; ok — можно
// писать. Админам не блокируем (как и сервер). ready=false, пока не знаем лимит.

export type ChatAccessReason = "ok" | "expired" | "quota";

export interface ChatAccess {
  ready: boolean;
  locked: boolean;
  reason: ChatAccessReason;
  // Лимит проектов тарифа (-1 = без лимита, null = пока неизвестно/нет тарифа).
  // Применяется в UI к числу проектов (см. AppShell/chat-page). Для админа -1.
  projectsLimit: number | null;
  // Сколько проектов на Instagram даёт тариф. ⚠️ Считается ОТДЕЛЬНО от projectsLimit:
  // 0 — площадка на тарифе не продаётся (карточка выбора закрыта), -1 — без лимита.
  instagramLimit: number;
  // Включён ли на тарифе отчёт по каналу для клиента (см. PlanLimits.reports).
  // Рубильник, а не счётчик: true — кнопка отчёта есть.
  reportsEnabled: boolean;
}

export function useChatAccess(): ChatAccess {
  const user = useAppSelector((s) => s.auth.user);
  const requestsUsed = user?.requestsUsed ?? 0;
  const planExpiresAt = user?.planExpiresAt ?? null;
  const plan = user?.plan;
  const isAdmin = user?.role === "admin";

  const [limit, setLimit] = useState<number | null>(null);
  const [projectsLimit, setProjectsLimit] = useState<number | null>(null);
  const [instagramLimit, setInstagramLimit] = useState(0);
  const [reportsEnabled, setReportsEnabled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user || isAdmin) {
      setReady(true);
      return;
    }
    let active = true;
    // Тариф ищем и среди архивных (findUserPlan): подписка на снятый с витрины
    // тариф продолжает действовать — лимиты берём его.
    fetchPlansView()
      .then((view) => {
        if (!active) return;
        const p = findUserPlan(view, plan);
        setLimit(p ? p.limits.requests : null);
        setProjectsLimit(p ? p.limits.projects : null);
        setInstagramLimit(p ? p.limits.instagram : 0);
        setReportsEnabled(Boolean(p && p.limits.reports > 0));
        setReady(true);
      })
      .catch(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [user, isAdmin, plan]);

  // Админ и гость (на /chat гостей нет — гейтит middleware) не блокируются, проекты
  // без лимита (-1).
  if (!user || isAdmin) {
    return {
      ready: true,
      locked: false,
      reason: "ok",
      projectsLimit: isAdmin ? -1 : null,
      // Админу площадки не режем — иначе он не сможет проверить Instagram-проект.
      instagramLimit: isAdmin ? -1 : 0,
      reportsEnabled: isAdmin,
    };
  }

  const expired = planExpiresAt ? new Date(planExpiresAt).getTime() <= Date.now() : false;
  const quotaExceeded = limit != null && limit >= 0 && requestsUsed >= limit;
  const reason: ChatAccessReason = expired ? "expired" : quotaExceeded ? "quota" : "ok";

  return {
    ready,
    locked: reason !== "ok",
    reason,
    projectsLimit,
    instagramLimit,
    reportsEnabled,
  };
}
