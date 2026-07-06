"use client";

import { useEffect, useRef, useState } from "react";
import {
  Tabs,
  Textarea,
  TextInput,
  Stack,
  Text,
  SimpleGrid,
  SegmentedControl,
  Box,
  Divider,
  Loader,
} from "@mantine/core";
import {
  IconUser,
  IconCreditCard,
  IconLanguage,
  IconCheck,
  IconPlug,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setAboutYou, setLanguage } from "@/store/settingsSlice";
import { authenticated } from "@/store/authSlice";
import { apiUpdateProfile } from "@/lib/auth-client";
import PlanCards from "@/components/Billing/PlanCards";
import YouTubeConnect from "@/components/Settings/YouTubeConnect";

// Тело настроек (вкладки Основные/Биллинг/Язык) — общий блок для модалки
// (SettingsModal, открывается из меню профиля и при «Оформить» с лендинга) и для
// страницы /settings (вкладка горизонтального меню). Вся логика автосейва имени,
// «о себе» и языка — здесь.
export default function SettingsContent({
  initialTab = "general",
  projectId,
}: {
  // На какой вкладке стартовать (например, "billing" — приход с «Оформить»).
  initialTab?: string;
  // Если задан — это настройки ПРОЕКТА: показываем вкладку «Интеграции» (YouTube
  // пер-проектный). В аккаунтной модалке (меню профиля) projectId нет → таба нет.
  projectId?: string;
}) {
  const dispatch = useAppDispatch();
  const user = useAppSelector((s) => s.auth.user);
  const [tab, setTab] = useState<string | null>(initialTab);
  const aboutYou = useAppSelector((s) => s.settings.aboutYou);
  const language = useAppSelector((s) => s.settings.language);

  // ── Аккаунт: имя («как обращаться») ────────────────────────────────────
  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Подхватываем имя из стора (после гидратации /me или смены аккаунта).
  useEffect(() => {
    setName(user?.name ?? "");
  }, [user?.name]);

  // Чистим таймер дебаунса при размонтировании.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    []
  );

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

  return (
    <Tabs value={tab} onChange={setTab} variant="pills" color="brand">
      <Tabs.List mb="md">
        <Tabs.Tab value="general" leftSection={<IconUser size={16} />}>
          Основные
        </Tabs.Tab>
        {projectId && (
          <Tabs.Tab value="integrations" leftSection={<IconPlug size={16} />}>
            Интеграции
          </Tabs.Tab>
        )}
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
              {/* Подтверждение почты убрали — показываем просто адрес. */}
              <TextInput
                label="Почта"
                value={user.email}
                readOnly
                styles={{ input: { cursor: "default" } }}
              />
            </SimpleGrid>
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
        {/* Бриф теперь у каждого проекта свой (создаётся при «Новый проект»),
            отдельной кнопки «пройти бриф» в настройках больше нет. */}
      </Tabs.Panel>

      {/* ── Интеграции (пер-проектные) ────────────────────────────── */}
      {projectId && (
        <Tabs.Panel value="integrations">
          <YouTubeConnect projectId={projectId} />
        </Tabs.Panel>
      )}

      {/* ── Биллинг ───────────────────────────────────────────────── */}
      <Tabs.Panel value="billing">
        {/* Карточки тарифов + оплата — общий блок (см. components/Billing). */}
        <PlanCards showStatus />
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
  );
}
