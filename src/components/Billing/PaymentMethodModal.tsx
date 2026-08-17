"use client";

import { useState } from "react";
import { Modal, Stack, Text, Group, Button, ThemeIcon, Alert, Box } from "@mantine/core";
import { IconCreditCard, IconWorld, IconInfoCircle } from "@tabler/icons-react";
import { apiCreatePayment, apiCreateCloudPayment } from "@/lib/auth-client";
import { openCloudPaymentsWidget } from "@/lib/cloudpayments-widget";
import { formatPrice, type PublicPlan } from "@/lib/plans";
import { ymGoal } from "@/lib/metrika";
import { utmGoalParams } from "@/lib/utm";
import { readPaymentAttribution } from "@/lib/utm-client";

// Выбор способа оплаты при оформлении тарифа: превью названия/цены + два пути —
// российская карта (ТБанк: СБП/Мир, редирект) или зарубежная (CloudPayments-виджет
// на месте). Открывается из PlanCards по клику «Перейти».
export default function PaymentMethodModal({
  plan,
  onClose,
}: {
  plan: PublicPlan | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"ru" | "foreign" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Зарубежные карты доступны только если задан публичный ключ CloudPayments.
  const foreignAvailable = Boolean(process.env.NEXT_PUBLIC_CLOUDPAYMENTS_PUBLIC_ID);

  const payRu = async () => {
    if (!plan) return;
    setError(null);
    setBusy("ru");
    const res = await apiCreatePayment(plan.id);
    if (res.ok) {
      ymGoal("payment_start", {
        plan: plan.id,
        method: "ru",
        ...utmGoalParams(readPaymentAttribution()),
      });
      window.location.href = res.data.url; // редирект на страницу ТБанк
      return;
    }
    setError(res.error);
    setBusy(null);
  };

  const payForeign = async () => {
    if (!plan) return;
    setError(null);
    setBusy("foreign");
    const res = await apiCreateCloudPayment(plan.id);
    if (!res.ok) {
      setError(res.error);
      setBusy(null);
      return;
    }
    ymGoal("payment_start", {
      plan: plan.id,
      method: "foreign",
      ...utmGoalParams(readPaymentAttribution()),
    });
    try {
      const result = await openCloudPaymentsWidget(res.data.params);
      if (result === "success") {
        // Итог сверит страница результата (синк CloudPayments find по InvoiceId).
        window.location.href = `/payment?order=${encodeURIComponent(res.data.params.invoiceId)}`;
        return;
      }
      if (result === "fail") {
        setError("Оплата не прошла. Попробуйте другую карту или способ.");
      }
    } catch {
      setError("Не удалось открыть форму оплаты. Проверьте соединение и попробуйте снова.");
    }
    setBusy(null);
  };

  return (
    <Modal
      opened={plan != null}
      onClose={() => {
        if (busy) return; // не закрываем во время обработки
        setError(null);
        onClose();
      }}
      title="Оформление тарифа"
      centered
      radius="md"
    >
      {plan && (
        <Stack gap="md">
          {/* Превью тарифа */}
          <Box>
            <Text fw={600} fz="lg">
              {plan.label}
            </Text>
            <Group gap={6} align="baseline">
              <Text fw={700} fz="xl" style={{ letterSpacing: "-0.02em" }}>
                {formatPrice(plan.priceRub)}
              </Text>
              <Text size="sm" c="dimmed">
                / {plan.period}
              </Text>
            </Group>
          </Box>

          <Text size="sm" c="dimmed">
            Выберите способ оплаты:
          </Text>

          <Stack gap="sm">
            <PayOption
              icon={<IconCreditCard size={22} />}
              title="Российская карта"
              subtitle="СБП, Мир, карты российских банков"
              onClick={payRu}
              loading={busy === "ru"}
              disabled={busy != null}
            />
            <PayOption
              icon={<IconWorld size={22} />}
              title="Зарубежная карта"
              subtitle={
                foreignAvailable
                  ? "Visa, Mastercard и другие иностранные карты"
                  : "Скоро — пока недоступно"
              }
              onClick={payForeign}
              loading={busy === "foreign"}
              disabled={busy != null || !foreignAvailable}
            />
          </Stack>

          {error && (
            <Alert
              color="red"
              variant="light"
              radius="md"
              icon={<IconInfoCircle size={18} />}
              withCloseButton
              onClose={() => setError(null)}
            >
              {error}
            </Alert>
          )}
        </Stack>
      )}
    </Modal>
  );
}

function PayOption({
  icon,
  title,
  subtitle,
  onClick,
  loading,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  return (
    <Button
      variant="default"
      radius="md"
      onClick={onClick}
      loading={loading}
      disabled={disabled}
      justify="flex-start"
      h="auto"
      styles={{ root: { paddingTop: 12, paddingBottom: 12 }, label: { width: "100%" } }}
    >
      <Group gap="sm" wrap="nowrap" w="100%">
        <ThemeIcon variant="light" color="brand" radius="md" size={40} style={{ flexShrink: 0 }}>
          {icon}
        </ThemeIcon>
        <Box style={{ textAlign: "left", minWidth: 0 }}>
          <Text fw={600} size="sm">
            {title}
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "normal" }}>
            {subtitle}
          </Text>
        </Box>
      </Group>
    </Button>
  );
}
