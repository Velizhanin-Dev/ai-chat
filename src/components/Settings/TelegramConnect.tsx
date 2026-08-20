"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Box, Button, Group, Paper, Text } from "@mantine/core";
import { IconBrandTelegram, IconCheck } from "@tabler/icons-react";

// Интеграция аккаунта с Telegram-ботом. Привязка ОДНА на пользователя (не на
// проект): бот пишет человеку в личку, и второго телеграма у него нет. Через неё
// работают и поддержка, и уведомления «у конкурента залетел ролик».
//
// ⚠️ Ссылку с одноразовым токеном берём ПО КЛИКУ, а не при рендере: иначе каждый
// показ страницы плодил бы токены в базе.
// ⚠️ Окно открываем СРАЗУ, до запроса, и только потом подставляем адрес — иначе
// Safari и мобильные браузеры режут открытие как попап («не по клику»).
export default function TelegramConnect({
  compact = false,
  onLinked,
}: {
  /** Компактный вид — для врезки внутри раздела, без своей подложки. */
  compact?: boolean;
  onLinked?: () => void;
}) {
  const [linked, setLinked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // ⚠️ Колбэк держим в ref, а не в зависимостях check: родитель почти всегда
  // передаёт инлайновую стрелку, у неё каждый рендер новая ссылка — эффект
  // «проверить привязку» пересоздавался бы и уходил в бесконечный опрос сервера.
  const onLinkedRef = useRef(onLinked);
  onLinkedRef.current = onLinked;

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/support/telegram", { cache: "no-store" });
      const data = (await res.json()) as { linked?: boolean };
      setLinked(Boolean(data.linked));
      if (data.linked) onLinkedRef.current?.();
    } catch {
      setLinked(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // Возврат из телеграма — вкладка снова видима, перепроверяем привязку.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  const open = async () => {
    setBusy(true);
    const w = window.open("", "_blank");
    try {
      const res = await fetch("/api/support/telegram", { cache: "no-store" });
      const data = (await res.json()) as { url?: string };
      if (data.url && w) w.location.href = data.url;
      else if (data.url) window.location.href = data.url;
      else w?.close();
    } catch {
      w?.close();
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <Group justify="space-between" wrap="wrap" gap="sm">
      <Box style={{ minWidth: 0 }}>
        <Group gap={8}>
          <IconBrandTelegram size={18} />
          <Text fw={600}>Telegram</Text>
          {linked && (
            <Badge size="sm" color="teal" variant="light" leftSection={<IconCheck size={11} />}>
              привязан
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed" mt={4}>
          {linked
            ? "Бот пишет тебе в личку: ответы поддержки и уведомления о конкурентах."
            : "Привяжи аккаунт к боту — туда придут ответы поддержки и уведомления, когда у конкурента залетит ролик."}
        </Text>
      </Box>
      <Button
        variant={linked ? "default" : "light"}
        color="brand"
        loading={busy}
        leftSection={<IconBrandTelegram size={16} />}
        onClick={() => void open()}
      >
        {linked ? "Открыть бота" : "Подключить телеграм"}
      </Button>
    </Group>
  );

  return compact ? body : (
    <Paper className="an-surface" p="md">
      {body}
    </Paper>
  );
}
