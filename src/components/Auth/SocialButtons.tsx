"use client";

import { SimpleGrid, Button, Tooltip } from "@mantine/core";
import { IconBrandVk, IconBrandYandex } from "@tabler/icons-react";

// Соц-вход (VK / Яндекс) — пока недоступен: OAuth-провайдеры не подключены.
// Кнопки оставлены задизейбленными с подсказкой «скоро», чтобы не обещать
// несуществующий способ входа.
const PROVIDERS = [
  { id: "vk", label: "VK", Icon: IconBrandVk, color: "#0077FF" },
  { id: "yandex", label: "Яндекс", Icon: IconBrandYandex, color: "#FC3F1D" },
] as const;

export default function SocialButtons() {
  return (
    <SimpleGrid cols={2} spacing="sm">
      {PROVIDERS.map((p) => (
        <Tooltip key={p.id} label="Скоро" withArrow>
          <Button
            variant="default"
            radius="md"
            data-disabled
            onClick={(e) => e.preventDefault()}
            leftSection={<p.Icon size={18} style={{ color: p.color }} />}
          >
            {p.label}
          </Button>
        </Tooltip>
      ))}
    </SimpleGrid>
  );
}
