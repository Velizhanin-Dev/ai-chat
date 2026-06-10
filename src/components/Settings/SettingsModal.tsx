"use client";

import { useState } from "react";
import {
  Modal,
  Tabs,
  Textarea,
  Stack,
  Text,
  Group,
  Paper,
  Button,
  Badge,
  List,
  ThemeIcon,
  SimpleGrid,
  SegmentedControl,
  Box,
} from "@mantine/core";
import {
  IconUser,
  IconCreditCard,
  IconLanguage,
  IconCheck,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setAboutYou, setPlan, setLanguage } from "@/store/settingsSlice";
import { PLAN_LABEL, type PlanId } from "@/store/authSlice";

// Компактные тарифы для биллинга (мок). Срисованы с лендинга (Pricing.tsx),
// но меньше и привязаны к PlanId — без бэкенда.
const PLANS: {
  id: PlanId;
  price: string;
  period: string;
  features: string[];
}[] = [
  {
    id: "start",
    price: "0 ₽",
    period: "чтобы попробовать",
    features: ["Несколько сценариев в месяц", "Базовые форматы"],
  },
  {
    id: "blogger",
    price: "[цена] ₽",
    period: "в месяц",
    features: ["Безлимит сценариев", "Все 12 форматов", "История диалогов"],
  },
  {
    id: "studio",
    price: "по запросу",
    period: "для команд",
    features: ["Несколько мест", "Единый стандарт", "Приоритетная поддержка"],
  },
];

export default function SettingsModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const aboutYou = useAppSelector((s) => s.settings.aboutYou);
  const language = useAppSelector((s) => s.settings.language);
  const currentPlan = useAppSelector((s) => s.settings.plan);
  const [paid, setPaid] = useState<PlanId | null>(null);

  const handleChoosePlan = (id: PlanId) => {
    // Мок-оплата: без бэкенда просто переключаем тариф.
    dispatch(setPlan(id));
    setPaid(id);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={<Text fw={600} fz="lg">Настройки</Text>}
      size="lg"
      radius="lg"
      centered
    >
      <Tabs defaultValue="general" variant="pills" color="brand">
        <Tabs.List mb="md">
          <Tabs.Tab value="general" leftSection={<IconUser size={16} />}>
            Основные
          </Tabs.Tab>
          <Tabs.Tab value="billing" leftSection={<IconCreditCard size={16} />}>
            Биллинг
          </Tabs.Tab>
          <Tabs.Tab value="language" leftSection={<IconLanguage size={16} />}>
            Язык
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Основные ──────────────────────────────────────────────── */}
        <Tabs.Panel value="general">
          <Stack gap="xs">
            <Text fw={500}>О себе</Text>
            <Textarea
              placeholder="Напиши о себе и что ты делаешь"
              value={aboutYou}
              onChange={(e) => dispatch(setAboutYou(e.currentTarget.value))}
              autosize
              minRows={4}
              maxRows={10}
              maxLength={2000}
            />
            <Text size="xs" c="dimmed">
              Это описание автоматически подгружается в нейронку во всех чатах —
              ответы будут учитывать твою нишу и контекст. Сохраняется само.
            </Text>
          </Stack>
        </Tabs.Panel>

        {/* ── Биллинг ───────────────────────────────────────────────── */}
        <Tabs.Panel value="billing">
          <Stack gap="md">
            <Group gap="xs">
              <Text size="sm" c="dimmed">
                Текущий тариф:
              </Text>
              <Badge color="brand" variant="light" radius="sm">
                {PLAN_LABEL[currentPlan]}
              </Badge>
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              {PLANS.map((p) => {
                const active = p.id === currentPlan;
                return (
                  <Paper
                    key={p.id}
                    radius="md"
                    p="md"
                    withBorder
                    style={{
                      borderColor: active ? "var(--color-accent)" : undefined,
                      borderWidth: active ? 2 : 1,
                    }}
                  >
                    <Stack gap="xs" h="100%">
                      <Group justify="space-between">
                        <Text fw={600}>{PLAN_LABEL[p.id]}</Text>
                        {active && (
                          <Badge color="brand" size="sm" radius="sm">
                            Текущий
                          </Badge>
                        )}
                      </Group>
                      <div>
                        <Text fw={600} fz="xl" style={{ letterSpacing: "-0.02em" }}>
                          {p.price}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {p.period}
                        </Text>
                      </div>
                      <List
                        spacing={4}
                        size="xs"
                        icon={
                          <ThemeIcon color="brand" size={16} radius="xl" variant="light">
                            <IconCheck size={10} />
                          </ThemeIcon>
                        }
                      >
                        {p.features.map((f) => (
                          <List.Item key={f}>{f}</List.Item>
                        ))}
                      </List>
                      <Button
                        mt="auto"
                        radius="xl"
                        size="xs"
                        fullWidth
                        variant={active ? "light" : "filled"}
                        color="brand"
                        disabled={active}
                        onClick={() => handleChoosePlan(p.id)}
                      >
                        {active ? "Подключён" : "Оплатить"}
                      </Button>
                    </Stack>
                  </Paper>
                );
              })}
            </SimpleGrid>

            {paid && (
              <Text size="xs" c="dimmed">
                ✓ Оплата — заглушка (без бэкенда). Тариф переключён на «
                {PLAN_LABEL[paid]}».
              </Text>
            )}
          </Stack>
        </Tabs.Panel>

        {/* ── Язык ──────────────────────────────────────────────────── */}
        <Tabs.Panel value="language">
          <Stack gap="xs">
            <Text fw={500}>Язык интерфейса</Text>
            <Box>
              <SegmentedControl
                value={language}
                onChange={(v) => dispatch(setLanguage(v as "ru"))}
                data={[{ label: "Русский", value: "ru" }]}
              />
            </Box>
            <Text size="xs" c="dimmed">
              Другие языки — скоро.
            </Text>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  );
}
