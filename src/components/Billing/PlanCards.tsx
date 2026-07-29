"use client";

import { useEffect, useState } from "react";
import { Stack, Text, Paper, Button, List, ThemeIcon, SimpleGrid, Badge, Group } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import { fetchPlansView, findUserPlan } from "@/lib/plans-client";
import { formatPrice, type PublicPlan } from "@/lib/plans";
import PaymentMethodModal from "@/components/Billing/PaymentMethodModal";

// Карточки тарифов с кнопкой оплаты — общий блок для биллинга в настройках и для
// модалки «подписка закончилась». Логика одинаковая:
//  • купить можно только платный тариф; пробный — лишь статус (подключён/завершён),
//    после окончания заново его не дают;
//  • активный тариф (срок не истёк) подсвечен и не кликается;
//  • showStatus — строка «активен до … · осталось запросов» (нужна в настройках,
//    в модалке заголовок и так об этом говорит);
//  • АРХИВНЫЙ тариф юзера (снят с витрины) не продаётся, но показывается отдельной
//    карточкой с пометкой — подписка на него действует, человек должен видеть, что
//    у него подключено и какие лимиты.
export default function PlanCards({ showStatus = false }: { showStatus?: boolean }) {
  const user = useAppSelector((s) => s.auth.user);
  const currentPlan = user?.plan;
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  // Свой тариф, если он архивный (в витрину `plans` он не входит).
  const [archivedPlan, setArchivedPlan] = useState<PublicPlan | null>(null);
  // Выбранный для оплаты тариф → открывает модалку выбора способа оплаты.
  const [chosenPlan, setChosenPlan] = useState<PublicPlan | null>(null);

  useEffect(() => {
    let active = true;
    fetchPlansView()
      .then((v) => {
        if (!active) return;
        setPlans(v.plans);
        setArchivedPlan(v.currentPlan);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const planExpiry = user?.planExpiresAt ? new Date(user.planExpiresAt) : null;
  const planExpired = planExpiry ? planExpiry.getTime() <= Date.now() : false;
  const currentPlanDef = findUserPlan({ plans, currentPlan: archivedPlan }, currentPlan);
  // Свой архивный тариф показываем первой карточкой — иначе человек не увидит,
  // что у него вообще подключено (в витрине его нет).
  const cards = archivedPlan ? [archivedPlan, ...plans] : plans;
  const planLabel = currentPlanDef?.label ?? currentPlan ?? "";
  const requestLimit = currentPlanDef?.limits.requests ?? null;
  const requestsLeft =
    requestLimit != null && requestLimit >= 0
      ? Math.max(0, requestLimit - (user?.requestsUsed ?? 0))
      : null;

  return (
    <Stack gap="md">
      {showStatus && planExpiry && (
        <Text size="sm" c={planExpired ? "red" : "dimmed"}>
          {"Тариф "}
          <Text span fw={500} c={planExpired ? "red" : "brand"}>
            {planLabel}
          </Text>
          {planExpired ? " истёк " : " активен до "}
          <Text span fw={500} c={planExpired ? "red" : "brand"}>
            {planExpiry.toLocaleString("ru-RU", {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
          {!planExpired && requestsLeft != null && (
            <>
              {" · осталось запросов: "}
              <Text span fw={500} c="brand">
                {requestsLeft}
              </Text>
            </>
          )}
        </Text>
      )}
      <SimpleGrid cols={{ base: 1, sm: Math.min(Math.max(cards.length, 1), 3) }} spacing="sm">
        {cards.map((p) => {
          const isCurrent = p.id === currentPlan;
          const isActiveNow = isCurrent && !planExpired;
          // Архивный тариф (снят с витрины): подписка действует, но купить нельзя.
          const isArchived = !p.active;
          // Бесплатный/пробный тариф нельзя купить или включить заново:
          // выдаётся только при регистрации (после окончания — только платный).
          const isFree = p.priceRub <= 0;
          const active = isActiveNow;
          return (
            <Paper
              key={p.id}
              radius="md"
              p="md"
              withBorder
              style={{
                borderColor: active ? "var(--color-accent)" : undefined,
                borderWidth: active ? 2 : 1,
              }}
            >
              <Stack gap="xs" h="100%">
                <Group gap={6} wrap="nowrap" justify="space-between">
                  <Text fw={600}>{p.label}</Text>
                  {isArchived && (
                    <Badge color="gray" variant="light" radius="sm" size="sm">
                      архивный
                    </Badge>
                  )}
                </Group>
                <div>
                  <Text fw={600} fz="xl" style={{ letterSpacing: "-0.02em" }}>
                    {formatPrice(p.priceRub)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {p.period}
                  </Text>
                </div>
                <List
                  spacing={4}
                  size="xs"
                  icon={
                    <ThemeIcon color="brand" size={16} radius="xl" variant="light">
                      <IconCheck size={10} />
                    </ThemeIcon>
                  }
                >
                  {p.features.map((f) => (
                    <List.Item key={f}>{f}</List.Item>
                  ))}
                </List>
                <Button
                  mt="auto"
                  radius="xl"
                  size="xs"
                  fullWidth
                  variant={isActiveNow ? "light" : "filled"}
                  color="brand"
                  // Купить можно только платный тариф с витрины. Пробный и архивный —
                  // лишь статус (подключён / завершён / недоступен), без действия.
                  disabled={isActiveNow || isFree || isArchived}
                  onClick={() => !isFree && !isArchived && setChosenPlan(p)}
                >
                  {isActiveNow
                    ? "Подключён"
                    : isArchived
                    ? "Больше не продаётся"
                    : isFree
                    ? isCurrent
                      ? "Завершён"
                      : "Только при регистрации"
                    : "Перейти"}
                </Button>
              </Stack>
            </Paper>
          );
        })}
      </SimpleGrid>

      <PaymentMethodModal plan={chosenPlan} onClose={() => setChosenPlan(null)} />
    </Stack>
  );
}
