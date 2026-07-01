import { Box, Stack, ThemeIcon, Title, Text } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";

// Заглушка для разделов «в разработке» (Канал / Генератор креативов / Разборы).
// Без хуков → можно рендерить из серверного компонента страницы. Сами роуты под
// серверным админ-гвардом — сюда доходит только админ.
export default function ComingSoon({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Box
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 0,
      }}
    >
      <Stack align="center" gap="md" maw={440} px="md" ta="center">
        <ThemeIcon color="brand" variant="light" radius="xl" size={56}>
          <IconLock size={28} />
        </ThemeIcon>
        <Title order={3}>{title}</Title>
        <Text c="dimmed">{description}</Text>
      </Stack>
    </Box>
  );
}
