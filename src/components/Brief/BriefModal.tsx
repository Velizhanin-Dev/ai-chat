"use client";

import { Modal, Group, Button, Text, ThemeIcon } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconClipboardText, IconArrowRight } from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { authenticated } from "@/store/authSlice";
import { apiSaveBrief } from "@/lib/auth-client";
import type { Brief } from "@/lib/brief";
import BriefFlow from "@/components/Brief/BriefFlow";

// Обязательный онбординг + кнопка «Пройти бриф заново» в настройках. Сам визард
// живёт в BriefFlow (общий со страницей по QR). Здесь — только chrome модалки,
// сохранение на бэкенд и переход в чат на финале.
const DRAFT_KEY = "creative-chat:brief-draft-v1";

export default function BriefModal({
  opened,
  onClose,
  mandatory = false,
}: {
  opened: boolean;
  onClose: () => void;
  mandatory?: boolean;
}) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  // На мобиле — на весь экран: больше места под клавиатуру, поле и кнопки не
  // прячутся (см. также scrollIntoView в BriefFlow).
  const isMobile = useMediaQuery("(max-width: 48em)");

  const handleSubmit = async (brief: Brief) => {
    const res = await apiSaveBrief(brief);
    if (res.ok) dispatch(authenticated(res.data.user));
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="md"
      radius={isMobile ? 0 : "lg"}
      centered
      fullScreen={isMobile}
      withCloseButton={!mandatory}
      closeOnClickOutside={!mandatory}
      closeOnEscape={!mandatory}
      styles={{
        // Тело модалки — скроллится; снизу запас, чтобы кнопки не прятались под
        // мобильной клавиатурой.
        body: { paddingBottom: isMobile ? "max(24px, env(safe-area-inset-bottom))" : undefined },
      }}
      title={
        <Group gap="xs">
          <ThemeIcon color="brand" variant="light" radius="md" size="md">
            <IconClipboardText size={16} />
          </ThemeIcon>
          <Text fw={600} fz="lg">
            Знакомство перед стартом
          </Text>
        </Group>
      }
    >
      {/* Монтируем визард только когда модалка открыта — так состояние/черновик
          восстанавливаются заново на каждое открытие (в т.ч. «пройти заново»). */}
      {opened && (
        <BriefFlow
          initialBrief={user?.brief ?? null}
          draftKey={DRAFT_KEY}
          draftScope={user?.id ?? "anon"}
          onSubmit={handleSubmit}
          resultNote={
            <Text size="sm" c="dimmed">
              Готово — я буду это учитывать в каждом ответе. Поменять можно в любой
              момент в настройках, кнопка «Пройти бриф заново».
            </Text>
          }
          resultActions={() => (
            <Button
              color="brand"
              radius="md"
              rightSection={<IconArrowRight size={16} />}
              onClick={onClose}
            >
              Поехали в чат
            </Button>
          )}
        />
      )}
    </Modal>
  );
}
