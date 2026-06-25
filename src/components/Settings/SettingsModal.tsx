"use client";

import { useEffect, useRef, useState } from "react";
import {
  Modal,
  Tabs,
  Textarea,
  TextInput,
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
  Divider,
  Loader,
  Tooltip,
  Alert,
} from "@mantine/core";
import {
  IconUser,
  IconCreditCard,
  IconLanguage,
  IconCheck,
  IconMailCheck,
  IconMailExclamation,
  IconClipboardText,
  IconSparkles,
  IconInfoCircle,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setAboutYou, setLanguage } from "@/store/settingsSlice";
import { authenticated } from "@/store/authSlice";
import { apiUpdateProfile, apiResendVerification, apiCreatePayment } from "@/lib/auth-client";
import { DISC_PROFILES } from "@/lib/brief";
import { formatPrice, type PublicPlan } from "@/lib/plans";

export default function SettingsModal({
  opened,
  onClose,
  onRetakeBrief,
}: {
  opened: boolean;
  onClose: () => void;
  onRetakeBrief: () => void;
}) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const aboutYou = useAppSelector((s) => s.settings.aboutYou);
  const language = useAppSelector((s) => s.settings.language);
  const currentPlan = useAppSelector((s) => s.settings.plan);
  // Оплата тарифа: какой план сейчас оформляется (лоадер на кнопке) и ошибка.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  // Тарифы из БД (редактируются в админке). Тянем при открытии настроек.
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  // Профиль типа харизмы по сохранённому брифу (если пройден).
  const briefProfile = user?.brief?.disc ? DISC_PROFILES[user.brief.disc] : null;

  // ── Аккаунт: имя («как обращаться») и подтверждение почты ───────────────
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Подхватываем имя из стора (после гидратации /me или смены аккаунта).
  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  // Тарифы для биллинга — из публичного эндпоинта, при открытии модалки.
  useEffect(() => {
    if (!opened) return;
    fetch("/api/plans", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { plans: PublicPlan[] }) => setPlans(d.plans))
      .catch(() => {});
  }, [opened]);

  // Чистим таймер дебаунса при размонтировании.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const saveName = async (value: string) => {
    setNameError(null);
    setSavingName(true);
    const res = await apiUpdateProfile({ name: value });
    setSavingName(false);
    if (!res.ok) {
      setNameError(res.error);
      return;
    }
    dispatch(authenticated(res.data.user));
    setNameSaved(true);
  };

  // Автосохранение имени с дебаунсом: ждём паузу в наборе и шлём PATCH сами.
  const onNameChange = (value: string) => {
    setName(value);
    setNameSaved(false);
    setNameError(null);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const trimmed = value.trim();
    // Не сохраняем пустое/слишком короткое или без изменений.
    if (trimmed.length < 2 || trimmed === (user?.name ?? "")) return;
    saveTimer.current = setTimeout(() => saveName(trimmed), 700);
  };

  const resendVerification = async () => {
    setResendState("sending");
    await apiResendVerification();
    setResendState("sent");
  };

  const handleChoosePlan = async (id: string) => {
    setPayError(null);
    setPayingId(id);
    const res = await apiCreatePayment(id);
    if (res.ok) {
      // Уходим на платёжную страницу ТБанк (лоадер не снимаем — навигация).
      window.location.href = res.data.url;
      return;
    }
    setPayError(res.error);
    setPayingId(null);
  };

  // «Тариф активен до …» — для платных тарифов со сроком (после оплаты).
  const planExpiry = user?.planExpiresAt ? new Date(user.planExpiresAt) : null;

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
          {/* Аккаунт */}
          <Stack gap="sm" mb="md">
            <Text fw={500}>Аккаунт</Text>
            {user ? (
              <>
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                  <TextInput
                    label="Как к вам обращаться"
                    value={name}
                    onChange={(e) => onNameChange(e.currentTarget.value)}
                    error={nameError}
                    maxLength={80}
                    rightSection={
                      savingName ? (
                        <Loader size="xs" color="brand" />
                      ) : nameSaved ? (
                        <IconCheck size={16} color="var(--mantine-color-teal-6)" />
                      ) : null
                    }
                  />
                  <TextInput
                    label="Почта"
                    value={user.email}
                    readOnly
                    styles={{ input: { cursor: "default" } }}
                    rightSection={
                      <Tooltip
                        label={user.emailVerified ? "Почта подтверждена" : "Почта не подтверждена"}
                        withArrow
                      >
                        {user.emailVerified ? (
                          <IconMailCheck size={16} color="var(--mantine-color-teal-6)" />
                        ) : (
                          <IconMailExclamation size={16} color="var(--mantine-color-orange-6)" />
                        )}
                      </Tooltip>
                    }
                  />
                </SimpleGrid>

                {!user.emailVerified && (
                  <Group gap="sm" align="center">
                    <Text size="xs" c="dimmed">
                      Почта не подтверждена.
                    </Text>
                    <Button
                      size="xs"
                      variant="light"
                      color="brand"
                      radius="xl"
                      onClick={resendVerification}
                      loading={resendState === "sending"}
                      disabled={resendState === "sent"}
                    >
                      {resendState === "sent" ? "Письмо отправлено" : "Отправить заново"}
                    </Button>
                  </Group>
                )}
              </>
            ) : (
              <Text size="sm" c="dimmed">
                Войдите, чтобы управлять аккаунтом.
              </Text>
            )}
          </Stack>

          <Divider mb="md" />

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

          <Divider my="md" />

          {/* Бриф клиента + тип харизмы (DISC) */}
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={500}>Бриф и тип харизмы</Text>
              {briefProfile && (
                <Badge color="brand" variant="light" radius="sm" leftSection={<IconSparkles size={11} />}>
                  {briefProfile.nick}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {briefProfile
                ? "По брифу и тесту DISC я подбираю форматы и подачу под тебя. Можно пройти заново — например, если сменилась ниша или проект."
                : "Бриф ещё не пройден — пройди его, чтобы я понимал твой проект и тип харизмы."}
            </Text>
            <Group>
              <Button
                variant="light"
                color="brand"
                radius="md"
                size="xs"
                leftSection={<IconClipboardText size={14} />}
                onClick={onRetakeBrief}
              >
                {briefProfile ? "Пройти бриф заново" : "Пройти бриф"}
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        {/* ── Биллинг ───────────────────────────────────────────────── */}
        <Tabs.Panel value="billing">
          <Stack gap="md">
            {planExpiry && (
              <Text size="sm" c="dimmed">
                Тариф активен до{" "}
                <Text span fw={500} c="brand">
                  {planExpiry.toLocaleDateString("ru-RU")}
                </Text>
              </Text>
            )}
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
              {plans.map((p) => {
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
                      <Text fw={600}>{p.label}</Text>
                      <div>
                        <Text fw={600} fz="xl" style={{ letterSpacing: "-0.02em" }}>
                          {formatPrice(p.priceRub)}
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
                        loading={payingId === p.id}
                        onClick={() => handleChoosePlan(p.id)}
                      >
                        {active ? "Подключён" : "Перейти"}
                      </Button>
                    </Stack>
                  </Paper>
                );
              })}
            </SimpleGrid>

            {payError && (
              <Alert
                color="red"
                variant="light"
                radius="md"
                icon={<IconInfoCircle size={18} />}
                withCloseButton
                onClose={() => setPayError(null)}
                title="Не удалось перейти к оплате"
              >
                {payError}. Если повторяется — напишите нам, откроем доступ вручную.
              </Alert>
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
