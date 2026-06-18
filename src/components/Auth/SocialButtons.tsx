"use client";

import { SimpleGrid, Button } from "@mantine/core";
import { IconBrandVk, IconBrandYandex } from "@tabler/icons-react";

// Соц-вход через VK ID / Яндекс. Кнопка — обычная ссылка на старт OAuth
// (/api/auth/oauth/<provider>); сервер редиректит на провайдера. Если провайдер
// не сконфигурирован (нет ключей в env), сервер вернёт на /login?error=oauth_unavailable.
const PROVIDERS = [
  { id: "vk", label: "VK", Icon: IconBrandVk, color: "#0077FF" },
  { id: "yandex", label: "Яндекс", Icon: IconBrandYandex, color: "#FC3F1D" },
] as const;

export default function SocialButtons() {
  return (
    <SimpleGrid cols={2} spacing="sm">
      {PROVIDERS.map((p) => (
        <Button
          key={p.id}
          component="a"
          href={`/api/auth/oauth/${p.id}`}
          variant="default"
          radius="md"
          leftSection={<p.Icon size={18} style={{ color: p.color }} />}
        >
          {p.label}
        </Button>
      ))}
    </SimpleGrid>
  );
}
