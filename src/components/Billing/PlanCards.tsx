"use client";

import { useEffect, useState } from "react";
import {
  Stack,
  Text,
  Paper,
  Button,
  List,
  ThemeIcon,
  SimpleGrid,
  Alert,
} from "@mantine/core";
import { IconCheck, IconInfoCircle } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import { apiCreatePayment } from "@/lib/auth-client";
import { fetchActivePlans } from "@/lib/plans-client";
import { formatPrice, type PublicPlan } from "@/lib/plans";
import { ymGoal } from "@/lib/metrika";

// Карточки тарифов с кнопкой оплаты — общий блок для биллинга в настройках и для
// модалки «подписка закончилась». Логика одинаковая:
//  • купить можно только платный тариф; пробный — лишь статус (подключён/завершён),
//    после окончания заново его не дают;
//  • активный тариф (срок не истёк) подсвечен и не кликается;
//  • showStatus — строка «активен до … · осталось запросов» (нужна в настройках,
//    в модалке заголовок и так об этом говорит).
export default function PlanCards({ showStatus = false }: { showStatus?: boolean }) {
  const user = useAppSelector((s) => s.auth.user);
  const currentPlan = user?.plan;
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchActivePlans()
      .then((p) => active && setPlans(p))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleChoosePlan = async (id: string) => {
    setPayError(null);
    setPayingId(id);
    const res = await apiCreatePayment(id);
    if (res.ok) {
      ymGoal("payment_start", { plan: id });
      // Уходим на платёжную страницу ТБанк (лоадер не снимаем — навигация).
      window.location.href = res.data.url;
      return;
    }
    setPayError(res.error);
    setPayingId(null);
  };

  const planExpiry = user?.planExpiresAt ? new Date(user.planExpiresAt) : null;
  const planExpired = planExpiry ? planExpiry.getTime() <= Date.now() : false;
  const currentPlanDef = plans.find((p) => p.id === currentPlan);
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
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlan;
          const isActiveNow = isCurrent && !planExpired;
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
                <Text fw={600}>{p.label}</Text>
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
                  // Купить можно только платный тариф. Пробный — лишь статус
                  // (подключён / завершён / недоступен), без действия.
                  disabled={isActiveNow || isFree}
                  loading={payingId === p.id}
                  onClick={() => !isFree && handleChoosePlan(p.id)}
                >
                  {isActiveNow
                    ? "Подключён"
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

      {payError && (
        <Alert
          color="red"
          variant="light"
          radius="md"
          icon={<IconInfoCircle size={18} />}
          withCloseButton
          onClose={() => setPayError(null)}
          title="Не удалось перейти к оплате"
        >
          {payError}. Если ошибка повторяется — напишите нам, исправим.
        </Alert>
      )}
    </Stack>
  );
}
