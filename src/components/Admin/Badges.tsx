"use client";

import { Badge } from "@mantine/core";
import { PLAN_LABEL, PLAN_BADGE_COLOR, type PlanId } from "@/store/authSlice";

// Общие бейджи для админки (список пользователей + страница платежей).

// Бейдж тарифа: цвет по тарифу + БЕЗ обрезки текста (на мобиле раньше «ПРО…»).
// minWidth:max-content держит бейдж не уже текста; label overflow visible гасит
// ellipsis, который Mantine вешает по умолчанию.
export function PlanBadge({ plan }: { plan: string }) {
  const label = PLAN_LABEL[plan as PlanId] ?? plan;
  const color = PLAN_BADGE_COLOR[plan as PlanId] ?? "gray";
  return (
    <Badge
      color={color}
      variant="light"
      radius="sm"
      styles={{ root: { minWidth: "max-content" }, label: { overflow: "visible" } }}
    >
      {label}
    </Badge>
  );
}

// Статус платежа ТБанк → цвет/подпись. Экспортируем и мету (для не-компонентного
// использования, если понадобится), и готовый бейдж.
export function paymentBadgeMeta(status: string): { color: string; label: string } {
  if (status === "CONFIRMED") return { color: "teal", label: "оплачено" };
  if (["REJECTED", "CANCELED", "DEADLINE_EXPIRED", "AUTH_FAIL"].includes(status))
    return { color: "red", label: "отклонён" };
  if (["REFUNDED", "PARTIAL_REFUNDED"].includes(status))
    return { color: "orange", label: "возврат" };
  return { color: "gray", label: "ожидает" };
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const { color, label } = paymentBadgeMeta(status);
  return (
    <Badge color={color} variant="light" radius="sm" style={{ flexShrink: 0 }}>
      {label}
    </Badge>
  );
}
