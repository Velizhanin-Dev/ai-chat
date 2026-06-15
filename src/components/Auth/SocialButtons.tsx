"use client";

import { SimpleGrid, Button } from "@mantine/core";
import { IconBrandVk, IconBrandYandex } from "@tabler/icons-react";

// Соц-вход — визуально, на заглушке. Клик дёргает onProvider (мок-вход).
// Оставлены только VK и Яндекс — единственные доп. способы входа.
const PROVIDERS = [
  { id: "vk", label: "VK", Icon: IconBrandVk, color: "#0077FF" },
  { id: "yandex", label: "Яндекс", Icon: IconBrandYandex, color: "#FC3F1D" },
] as const;

export default function SocialButtons({
  onProvider,
}: {
  onProvider?: (id: string) => void;
}) {
  return (
    <SimpleGrid cols={2} spacing="sm">
      {PROVIDERS.map((p) => (
        <Button
          key={p.id}
          variant="default"
          radius="md"
          leftSection={<p.Icon size={18} style={{ color: p.color }} />}
          onClick={() => onProvider?.(p.id)}
        >
          {p.label}
        </Button>
      ))}
    </SimpleGrid>
  );
}
