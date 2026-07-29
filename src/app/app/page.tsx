"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Title,
  Text,
  Stack,
  ThemeIcon,
  Button,
  Loader,
  Center,
  Alert,
} from "@mantine/core";
import { IconFolderPlus, IconAlertCircle } from "@tabler/icons-react";
import BriefFlow from "@/components/Brief/BriefFlow";
import YouTubeConnectStep from "@/components/Brief/YouTubeConnectStep";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { addProject, startBriefing, finishBriefing } from "@/store/chatSlice";
import { apiCreateProject } from "@/lib/chat-client";
import { apiBriefAutofill } from "@/lib/youtube-client";
import { readLastProject } from "@/lib/last-project";
import { readAnonBrief, clearAnonBrief } from "@/lib/anon-brief";
import { ymGoal } from "@/lib/metrika";
import { EMPTY_BRIEF, AUTOFILL_KEYS, type Brief } from "@/lib/brief";

// Черновик брифа нового проекта (восстанавливается при перезагрузке в процессе).
const PROJECT_BRIEF_DRAFT_KEY = "creative-chat:project-brief-draft-v1";

// Фазы создания проекта:
//   yt       — предлагаем подключить YouTube-канал (первый экран);
//   autofill — канал подключён, нейронка разбирает его и заполняет бриф;
//   brief    — сам визард брифа (с автозаполненными полями или пустой).
type Phase = "yt" | "autofill" | "brief";

// Экран приложения без выбранного проекта: создать/выбрать проект + визард брифа.
// Создание проекта (после брифа) уводит в чат проекта (/{id}/chat).
export default function AppHomePage() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const drafting = useAppSelector((s) => s.chat.drafting);
  const conversations = useAppSelector((s) => s.chat.conversations);
  const userId = useAppSelector((s) => s.auth.user?.id ?? null);
  const hydrated = useAppSelector((s) => s.chat.hydrated);

  // Код возврата из OAuth (?yt=...). Читаем ОДИН раз на маунте и сразу чистим URL:
  // после согласия Google возвращает на /app, а redux-флаг drafting полную
  // перезагрузку не переживает — поэтому по этому коду сами входим в режим брифа.
  const [ytCode, setYtCode] = useState<string | null>(null);
  const [ytRead, setYtRead] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("yt");
    if (code) {
      setYtCode(code);
      params.delete("yt");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : "")
      );
    }
    setYtRead(true);
  }, []);

  // Возвращаем режим создания проекта ПОСЛЕ гидратации списка: `hydrate` сбрасывает
  // `drafting` в false, поэтому включать его раньше бесполезно — затрёт.
  const ytDraftRef = useRef(false);
  useEffect(() => {
    if (!ytCode || !hydrated || ytDraftRef.current) return;
    ytDraftRef.current = true;
    dispatch(startBriefing());
  }, [ytCode, hydrated, dispatch]);

  // Если проекты уже есть — /app не задерживаем, уводим на последний открытый
  // (или самый свежий по обновлению). Экран создания остаётся только когда
  // проектов нет, и режим брифа (создание нового) редирект не трогает.
  const redirectedRef = useRef(false);
  useEffect(() => {
    // Вернулись из OAuth — остаёмся на /app в режиме создания проекта (флаг
    // drafting включится следующим эффектом, после гидратации), не уводим в чат.
    if (!ytRead || ytCode) return;
    if (!hydrated || drafting || conversations.length === 0) return;
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    const last = userId ? readLastProject(userId) : null;
    const target =
      last && conversations.some((c) => c.id === last)
        ? last
        : [...conversations].sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt)
          )[0].id;
    router.replace(`/${target}/chat`);
  }, [ytRead, ytCode, hydrated, drafting, conversations, userId, router]);

  // Созданный проект (для кнопки «Поехали в чат» на экране результата брифа).
  const [createdId, setCreatedId] = useState<string | null>(null);
  // На экране результата брифа расширяем контейнер и прячем заголовок.
  const [briefResult, setBriefResult] = useState(false);

  // ── Фаза создания проекта ──────────────────────────────────────────────────
  // Стартуем с предложения подключить канал; вернулись из OAuth с успехом —
  // сразу в автозаполнение (шаг подключения уже пройден).
  const [phase, setPhase] = useState<Phase>("yt");
  const [autofilled, setAutofilled] = useState<Brief | null>(null);
  const [autofillKeys, setAutofillKeys] = useState<string[]>([]);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  // Канал подключён в ЭТОМ прохождении брифа → при создании проекта просим сервер
  // перевесить черновое подключение на него.
  const [channelConnected, setChannelConnected] = useState(false);

  // Разбор канала: тянем поля брифа и уходим в визард. Ошибка не блокирует —
  // просто заполняем руками (текст ошибки показываем над брифом).
  const runAutofill = useCallback(() => {
    setPhase("autofill");
    setAutofillError(null);
    void apiBriefAutofill().then((res) => {
      if (res.ok) {
        const keys = AUTOFILL_KEYS.filter((k) => String(res.data[k] ?? "").length > 0);
        // Свежий разбор канала важнее старого черновика: иначе BriefFlow при
        // восстановлении отдаст приоритет незаконченному черновику (см. его
        // loadBriefDraft) и автозаполнение не увидят.
        try {
          localStorage.removeItem(PROJECT_BRIEF_DRAFT_KEY);
        } catch {
          /* приватный режим — не критично */
        }
        setAutofilled({ ...EMPTY_BRIEF, ...res.data });
        setAutofillKeys(keys);
        setChannelConnected(true);
      } else {
        // Канала нет — молча уходим в обычный бриф. Разбор не удался при живом
        // подключении — канал всё равно прицепим к проекту, бриф заполним руками.
        setChannelConnected(res.code !== "YT_NOT_CONNECTED");
        setAutofillError(
          res.code === "YT_NOT_CONNECTED"
            ? null
            : res.error || "Не получилось разобрать канал — заполним бриф вместе."
        );
      }
      setPhase("brief");
    });
  }, []);

  // Вернулись из OAuth с подключённым каналом → сразу разбираем его.
  const ytHandledRef = useRef(false);
  useEffect(() => {
    if (!drafting || ytHandledRef.current) return;
    if (ytCode !== "connected") return;
    ytHandledRef.current = true;
    runAutofill();
  }, [drafting, ytCode, runAutofill]);

  // Каждый заход в режим создания начинается с экрана подключения канала.
  useEffect(() => {
    if (!drafting) {
      setPhase("yt");
      setAutofilled(null);
      setAutofillKeys([]);
      setAutofillError(null);
      setChannelConnected(false);
      ytHandledRef.current = false;
    }
  }, [drafting]);

  // Бриф пройден в визарде → создаём проект, показываем экран результата (архетип),
  // переход в чат — по кнопке (см. resultActions ниже). Подключённый на первом шаге
  // канал прицепится к проекту на сервере (attachPendingConnection).
  const handleBriefSubmit = useCallback(
    async (brief: Brief): Promise<{ ok: boolean; error?: string }> => {
      const res = await apiCreateProject(brief, channelConnected);
      if (!res.ok) return { ok: false, error: res.error };
      dispatch(addProject(res.data));
      clearAnonBrief();
      ymGoal("brief_complete", { disc: brief.disc, source: "project" });
      setCreatedId(res.data.id);
      return { ok: true };
    },
    [dispatch, channelConnected]
  );

  // Если бриф уже пройден на /brief (анонимный бриф в localStorage) — не показываем
  // визард повторно, а сразу создаём проект и уходим в чат. На ошибке (или нет
  // анона) откатываемся к обычному визарду (с пре-филлом).
  const [creating, setCreating] = useState(false);
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!drafting) {
      autoTriedRef.current = false;
      return;
    }
    if (autoTriedRef.current) return;
    // Вернулись из OAuth — идём по флоу «канал → автозаполнение», анон-бриф не трогаем.
    if (ytCode) return;
    autoTriedRef.current = true;
    const anon = readAnonBrief();
    if (!anon) return;
    setCreating(true);
    void apiCreateProject(anon).then((res) => {
      setCreating(false);
      if (res.ok) {
        dispatch(addProject(res.data));
        clearAnonBrief();
        ymGoal("brief_complete", { disc: anon.disc, source: "qr" });
        dispatch(finishBriefing());
        router.push(`/${res.data.id}/chat`);
      }
      // не вышло — остаёмся в drafting, покажется визард с пре-филлом
    });
  }, [drafting, ytCode, dispatch, router]);

  if (drafting && creating) {
    // Бриф уже пройден (с /brief) — молча создаём проект, показываем лоадер.
    return (
      <Center style={{ flex: 1 }}>
        <Loader color="brand" />
      </Center>
    );
  }

  if (drafting) {
    const wide = briefResult;
    return (
      <Box style={{ flex: 1, overflowY: "auto", minHeight: 0 }} py="md">
        <Box maw={wide ? 900 : 560} mx="auto" px={{ base: 4, sm: 0 }}>
          {/* Заголовок прячем на экране результата — там полноэкранный reveal. */}
          {!briefResult && (
            <>
              <Title order={2} className="lp-h2" fz={{ base: "1.35rem", sm: "1.6rem" }} mb={4}>
                Новый проект
              </Title>
              <Text c="dimmed" size="sm" mb="lg">
                {phase === "yt"
                  ? "Начнём с канала — так я соберу бриф за тебя."
                  : "Пара вопросов о проекте и короткий тест — на их основе я буду собирать контент именно под него."}
              </Text>
            </>
          )}

          {/* Шаг 1 — подключение канала (можно пропустить). */}
          {phase === "yt" && (
            <YouTubeConnectStep
              ytError={ytCode}
              returnTo="/app"
              onSkip={() => setPhase("brief")}
              onContinue={runAutofill}
            />
          )}

          {/* Шаг 2 — нейронка разбирает канал. */}
          {phase === "autofill" && (
            <Stack align="center" gap="md" py={64}>
              <Loader color="brand" />
              <Text fw={600}>Изучаю твой канал</Text>
              <Text size="sm" c="dimmed" ta="center" maw={360}>
                Смотрю темы роликов, аудиторию и описание — заполню бриф за тебя.
              </Text>
            </Stack>
          )}

          {/* Шаг 3 — бриф (с автозаполненными полями или пустой). */}
          {phase === "brief" && (
            <>
              {autofillError && !briefResult && (
                <Alert
                  icon={<IconAlertCircle size={16} />}
                  color="orange"
                  variant="light"
                  mb="md"
                  withCloseButton
                  onClose={() => setAutofillError(null)}
                >
                  {autofillError}
                </Alert>
              )}
              <BriefFlow
                initialBrief={autofilled ?? readAnonBrief()}
                autofilledKeys={autofillKeys}
                draftKey={PROJECT_BRIEF_DRAFT_KEY}
                draftScope={userId ?? "anon"}
                onSubmit={handleBriefSubmit}
                onResultChange={(disc) => setBriefResult(disc !== null)}
                resultNote={
                  <Text size="sm" c="dimmed">
                    Готово — бриф проекта сохранён. Можно начинать.
                  </Text>
                }
                resultActions={() => (
                  <Button
                    color="brand"
                    radius="md"
                    onClick={() => {
                      dispatch(finishBriefing());
                      if (createdId) router.push(`/${createdId}/chat`);
                    }}
                  >
                    Поехали в чат
                  </Button>
                )}
              />
            </>
          )}
        </Box>
      </Box>
    );
  }

  // Не в режиме брифа: список ещё грузится или редиректим на существующий проект
  // (см. эффект выше) — показываем лоадер. Экран создания первого проекта
  // показываем только когда точно известно, что проектов нет.
  if (!hydrated || conversations.length > 0) {
    return (
      <Center style={{ flex: 1 }}>
        <Loader color="brand" />
      </Center>
    );
  }

  // Проектов нет — приглашение создать первый.
  return (
    <Box style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Stack align="center" gap="md" maw={420} px="md" ta="center">
        <ThemeIcon color="brand" variant="light" radius="xl" size={56}>
          <IconFolderPlus size={28} />
        </ThemeIcon>
        <Title order={3}>Создайте первый проект</Title>
        <Text c="dimmed">
          Каждый проект — это отдельный канал/продукт со своим брифом. Начните с
          короткого знакомства.
        </Text>
        <Button
          color="brand"
          radius="md"
          leftSection={<IconFolderPlus size={18} />}
          onClick={() => dispatch(startBriefing())}
        >
          Новый проект
        </Button>
      </Stack>
    </Box>
  );
}
