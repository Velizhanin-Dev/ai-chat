"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Box,
  Group,
  Stack,
  Paper,
  Title,
  Text,
  Button,
  ThemeIcon,
  Loader,
} from "@mantine/core";
import {
  IconCircleCheck,
  IconClockHour4,
  IconCircleX,
  IconArrowRight,
} from "@tabler/icons-react";
import Logo from "@/components/Brand/Logo";
import { useAppDispatch } from "@/store/hooks";
import { authenticated } from "@/store/authSlice";
import { apiPaymentStatus } from "@/lib/auth-client";
import { writeIntendedPlan } from "@/lib/intended-plan";
import { ymGoal } from "@/lib/metrika";

// Страница результата платежа (ТБанк возвращает сюда на SuccessURL/FailURL).
// Отдельная от /chat: на /chat результат перекрывался бы модалкой блокировки/
// тарифов. Здесь — чистый экран статуса с переходом в чат. Источник правды —
// синхронизация GetState (apiPaymentStatus): на успехе обновляем юзера в сторе,
// дальше «Перейти в чат» уже без гейта. Маршрут — в BARE_ROUTES (без чат-обвязки).

type Phase = "loading" | "success" | "pending" | "fail";

export default function PaymentResultPage() {
  const dispatch = useAppDispatch();
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const status = sp.get("status");
    const order = sp.get("order");

    if (status === "fail") {
      setPhase("fail");
      return;
    }
    if (!order) {
      setPhase("fail");
      return;
    }
    void apiPaymentStatus(order).then((res) => {
      if (res.ok && res.data.status === "CONFIRMED") {
        if (res.data.user) dispatch(authenticated(res.data.user));
        ymGoal("payment_success", { order });
        setPhase("success");
      } else {
        // NEW/обрабатывается — вебхук подтвердит позже.
        setPhase("pending");
      }
    });
  }, [dispatch]);

  const view = {
    loading: {
      icon: <Loader color="brand" />,
      color: "brand" as const,
      title: "Проверяем оплату…",
      text: "Секунду — уточняем статус платежа у банка.",
    },
    success: {
      icon: <IconCircleCheck size={32} />,
      color: "teal" as const,
      title: "Оплата прошла",
      text: "Тариф активирован. Можно возвращаться к работе — история диалогов на месте.",
    },
    pending: {
      icon: <IconClockHour4 size={32} />,
      color: "brand" as const,
      title: "Оплата обрабатывается",
      text: "Платёж принят. Тариф активируется автоматически сразу после подтверждения банком.",
    },
    fail: {
      icon: <IconCircleX size={32} />,
      color: "red" as const,
      title: "Оплата не завершена",
      text: "Платёж не прошёл. Попробуйте ещё раз — деньги при неуспешной оплате не списываются.",
    },
  }[phase];

  return (
    <Box
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--mantine-color-body)",
      }}
    >
      <Group p="md">
        <Logo href="/" />
      </Group>

      <Box
        style={{
          flex: 1,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "16px 16px max(40px, env(safe-area-inset-bottom))",
        }}
      >
        <Paper withBorder radius="lg" p={{ base: "lg", sm: "xl" }} w="100%" maw={440}>
          <Stack gap="md" align="center" ta="center">
            <ThemeIcon
              color={view.color}
              variant="light"
              radius="xl"
              size={64}
              aria-hidden
            >
              {view.icon}
            </ThemeIcon>
            <Title order={2} fz={{ base: "1.4rem", sm: "1.6rem" }}>
              {view.title}
            </Title>
            <Text c="dimmed">{view.text}</Text>

            {phase !== "loading" && (
              <Group justify="center" gap="sm" mt="xs">
                {phase === "fail" && (
                  <Button
                    component={Link}
                    href="/chat"
                    variant="default"
                    radius="md"
                    // Открыть окно тарифов в чате (тот же механизм, что «Оформить»).
                    onClick={() => writeIntendedPlan("retry")}
                  >
                    Выбрать тариф
                  </Button>
                )}
                <Button
                  component={Link}
                  href="/chat"
                  color="brand"
                  radius="md"
                  rightSection={<IconArrowRight size={16} />}
                >
                  Перейти в чат
                </Button>
              </Group>
            )}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
