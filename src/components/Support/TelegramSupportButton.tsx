"use client";

import { useState } from "react";
import { Button } from "@mantine/core";
import { IconBrandTelegram } from "@tabler/icons-react";

// Кнопка «Поддержка в Telegram». Ссылку с одноразовым токеном берём по клику, а
// не при рендере: иначе каждый показ страницы плодил бы токены в базе.
//
// ⚠️ Открываем окно СРАЗУ, до запроса, и только потом подставляем адрес — иначе
// Safari и мобильные браузеры считают открытие «не по клику» и режут его как
// попап.
export default function TelegramSupportButton({
  variant = "light",
  size = "sm",
  fullWidth = false,
}: {
  variant?: string;
  size?: string;
  fullWidth?: boolean;
}) {
  const [busy, setBusy] = useState(false);

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

  return (
    <Button
      variant={variant}
      color="brand"
      size={size}
      fullWidth={fullWidth}
      loading={busy}
      leftSection={<IconBrandTelegram size={16} />}
      onClick={() => void open()}
    >
      Поддержка в Telegram
    </Button>
  );
}
