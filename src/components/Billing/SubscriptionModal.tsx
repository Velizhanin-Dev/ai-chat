"use client";

import { Modal, Stack, Text, ThemeIcon, Group } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import PlanCards from "./PlanCards";
import type { ChatAccessReason } from "@/hooks/useChatAccess";

// Модалка «подписка закончилась» — показывается в чате, когда тариф истёк или
// кончились запросы. Закрыть можно (юзер может вернуться к истории), но писать в
// чат нельзя, пока не оформит тариф (см. ChatInput + серверный гейт /api/chat).
// Перейти на пробный нельзя — в PlanCards бесплатный тариф некликабелен.

export default function SubscriptionModal({
  opened,
  onClose,
  reason,
}: {
  opened: boolean;
  onClose: () => void;
  reason: ChatAccessReason;
}) {
  const quota = reason === "quota";
  const title = quota ? "Запросы закончились" : "Ваша подписка закончилась";
  const lead = quota
    ? "Лимит запросов на тарифе исчерпан. Приобретите подписку, чтобы продолжить — история диалогов сохранится."
    : "Приобретите подписку, чтобы продолжить общение. История диалогов сохранится.";

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      radius="lg"
      centered
      title={
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon color="brand" variant="light" radius="xl" size="lg">
            <IconLock size={18} />
          </ThemeIcon>
          <Text fw={600} fz="lg">
            {title}
          </Text>
        </Group>
      }
    >
      <Stack gap="md">
        <Text c="dimmed" size="sm">
          {lead}
        </Text>
        <PlanCards />
      </Stack>
    </Modal>
  );
}
