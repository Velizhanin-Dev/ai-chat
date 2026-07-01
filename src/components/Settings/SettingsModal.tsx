"use client";

import { Modal, Text } from "@mantine/core";
import SettingsContent from "./SettingsContent";

// Тонкая обёртка над SettingsContent: открывается из меню профиля и при приходе
// с «Оформить» лендинга (вкладка billing). Та же доменка живёт на странице
// /settings (вкладка горизонтального меню) — см. SettingsContent.
export default function SettingsModal({
  opened,
  onClose,
  initialTab = "general",
}: {
  opened: boolean;
  onClose: () => void;
  // На какой вкладке открыть (например, "billing" — приход с «Оформить» лендинга).
  initialTab?: string;
}) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Text fw={600} fz="lg">
          Настройки
        </Text>
      }
      size="lg"
      radius="lg"
      centered
    >
      {/* Монтируем контент только при открытии → вкладка сбрасывается на
          initialTab при каждом открытии (биллинг-намерение открывает на billing). */}
      {opened && <SettingsContent initialTab={initialTab} />}
    </Modal>
  );
}
