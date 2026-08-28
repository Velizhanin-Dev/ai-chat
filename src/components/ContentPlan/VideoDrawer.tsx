"use client";

import { ytImage, ytThumbById } from "@/lib/image-proxy";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  Checkbox,
  Divider,
  Drawer,
  Group,
  List,
  Popover,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconExternalLink,
  IconHelpCircle,
  IconLink,
  IconMessageCircle,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  CONTENT_PLAN_ADAPT_QUOTA_COST,
  CONTENT_PLAN_EDIT_QUOTA_COST,
  FORMAT_META,
  HUNT_LADDER_HINT,
  REGEN_LABEL,
  REGEN_PARTS,
  STATUS_META,
  STATUSES,
  formatMeta,
  type RegenPart,
  type VideoFormat,
  type VideoStatus,
  type VideoView,
} from "@/lib/content-plan";
import { apiVideoInsight } from "@/lib/competitors-client";
import { insightPromptBlock, videoIdFromUrl } from "@/lib/competitors";
import {
  apiAdaptCompetitorVideo,
  apiDeleteVideo,
  apiLinkVideo,
  apiRegenerateVideo,
  apiUpdateVideo,
} from "@/lib/content-plan-client";
import { useAppDispatch } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";
import { prefillInput } from "@/store/chatSlice";
import LinkVideoModal from "./LinkVideoModal";

// Детальная панель ролика. Сохранение — АВТОМАТИЧЕСКОЕ (debounce 800мс на любое
// изменение полей), кнопки «Сохранить» нет. Статус и привязка сохраняются сразу.

const AUTOSAVE_MS = 800;

// Название донора без служебного хвоста со ссылкой: из «Референсов» приезжает
// «Название (×5,3) — https://youtu.be/ID».
function referenceTitle(ref: string | null): string {
  const raw = (ref ?? "").trim();
  const cut = raw.split(/\s+—\s+https?:\/\//)[0];
  return cut || raw;
}

// Превью ролика по id из ссылки. Адрес выводится из id, поэтому API не трогаем.
function referenceThumb(ref: string | null): string | null {
  const url = referenceUrl(ref);
  if (!url) return null;
  const m =
    /youtu\.be\/([\w-]{6,})/.exec(url) ??
    /[?&]v=([\w-]{6,})/.exec(url) ??
    /\/shorts\/([\w-]{6,})/.exec(url);
  return m ? ytThumbById(m[1]) : null;
}

function referenceUrl(ref: string | null): string | null {
  const m = /https?:\/\/\S+/.exec(ref ?? "");
  return m ? m[0] : null;
}

/** id ролика из строки референса — по нему и переработка, и разбор донора. */
function refIdOf(ref: string | null): string | null {
  const url = referenceUrl(ref);
  return url ? videoIdFromUrl(url) : null;
}

export default function VideoDrawer({
  v,
  opened,
  onClose,
  onChange,
  onDelete,
  onAdapted,
  projectId,
  planId,
}: {
  v: VideoView | null;
  opened: boolean;
  onClose: () => void;
  onChange: (video: VideoView) => void;
  onDelete: (id: string) => void;
  /** Запись из свалки переработана: новая карточка + id заменённой записи. */
  onAdapted: (video: VideoView, replacedId: string) => void;
  projectId: string;
  planId: string;
}) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const [draft, setDraft] = useState<VideoView | null>(v);
  const [confirmDel, setConfirmDel] = useState(false);
  const [regen, setRegen] = useState<RegenPart | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [saved, setSaved] = useState(false); // индикатор «сохранено»
  // Тянем данные ролика-референса перед переходом в чат (кнопка ждёт).
  const [loadingRef, setLoadingRef] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);
  // Слепок последнего сохранённого состояния — чтобы автосейв не срабатывал на
  // подстановку данных с сервера (иначе получаем эхо-запросы).
  const savedSnapshot = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshot = (x: VideoView) =>
    JSON.stringify({
      titles: x.titles,
      previewTexts: x.previewTexts,
      format: x.format,
      noSpeaker: x.noSpeaker,
      huntStage: x.huntStage,
      pain: x.pain,
      questions: x.questions,
      nativeClose: x.nativeClose,
      reference: x.reference,
      whyWorks: x.whyWorks,
      opening: x.opening,
      cta: x.cta,
      visp: x.visp,
    });

  // Смена карточки — сбрасываем черновик и точку отсчёта автосейва.
  useEffect(() => {
    setDraft(v);
    setConfirmDel(false);
    setSaved(false);
    savedSnapshot.current = v ? snapshot(v) : "";
  }, [v]);

  const flush = useCallback(
    async (d: VideoView) => {
      const snap = snapshot(d);
      if (snap === savedSnapshot.current) return;
      savedSnapshot.current = snap;
      const res = await apiUpdateVideo(d.id, {
        titles: d.titles,
        previewTexts: d.previewTexts,
        format: d.format,
        noSpeaker: d.noSpeaker,
        huntStage: d.huntStage,
        pain: d.pain,
        questions: d.questions,
        nativeClose: d.nativeClose,
        reference: d.reference,
        whyWorks: d.whyWorks,
        opening: d.opening,
        cta: d.cta ?? undefined,
        visp: d.visp ?? undefined,
      });
      if (res.ok) {
        onChange(res.data.video);
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
      }
    },
    [onChange]
  );

  // Автосейв по debounce на изменение черновика.
  useEffect(() => {
    if (!draft) return;
    if (snapshot(draft) === savedSnapshot.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(draft), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, flush]);

  // Закрытие панели — дописываем несохранённое сразу, не ждём таймер.
  const closeAndFlush = () => {
    if (timer.current) clearTimeout(timer.current);
    if (draft) void flush(draft);
    onClose();
  };

  if (!draft) return null;
  const d = draft;
  const set = <K extends keyof VideoView>(key: K, val: VideoView[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: val } : prev));

  const changeStatus = async (status: VideoStatus) => {
    set("status", status);
    const res = await apiUpdateVideo(d.id, { status });
    if (res.ok) onChange(res.data.video);
  };

  const regenerate = async (part: RegenPart) => {
    setRegen(part);
    const res = await apiRegenerateVideo(d.id, part);
    setRegen(null);
    if (res.ok) {
      setDraft(res.data.video);
      savedSnapshot.current = snapshot(res.data.video);
      onChange(res.data.video);
      dispatch(bumpRequestsUsed(CONTENT_PLAN_EDIT_QUOTA_COST));
    }
  };

  const link = async (picked: { id: string; thumbnail: string | null; views: number } | null) => {
    setLinkOpen(false);
    const res = await apiLinkVideo(
      d.id,
      picked ? { youtubeVideoId: picked.id, thumbnail: picked.thumbnail, views: picked.views } : null
    );
    if (res.ok) {
      setDraft(res.data.video);
      savedSnapshot.current = snapshot(res.data.video);
      onChange(res.data.video);
    }
  };

  const del = async () => {
    const res = await apiDeleteVideo(d.id);
    if (res.ok) {
      onDelete(d.id);
      onClose();
    }
  };

  // Переработать донора из свалки в полноценную карточку (та же механика, что у
  // кнопки в «Референсах»): сервер тянет разбор ролика и расшифровку, модель
  // собирает карточку под нишу клиента.
  const adapt = async () => {
    const videoId = refIdOf(d.reference);
    if (!videoId || adapting) return;
    setAdapting(true);
    const res = await apiAdaptCompetitorVideo(planId, videoId, d.kind);
    setAdapting(false);
    if (!res.ok) {
      setAdaptError(res.error);
      return;
    }
    dispatch(bumpRequestsUsed(CONTENT_PLAN_ADAPT_QUOTA_COST));
    // Сырая запись из свалки заменяется готовой карточкой: держать обе — плодить
    // дубли, ссылка на донора при этом переезжает в новую карточку.
    //
    // ⚠️ Удаляем на СЕРВЕРЕ, а не только в состоянии страницы: иначе запись
    // вернётся на доску при первой же перезагрузке. Удаление после успешной
    // переработки — если она не удалась, запись должна остаться на месте.
    await apiDeleteVideo(d.id);
    onAdapted(res.data.video, d.id);
    onClose();
  };

  // «Сгенерировать сценарий» — уводим в чат проекта с полным брифом ролика.
  const toScript = async () => {
    const fmt = formatMeta(d.format)?.label ?? "";
    // ⚠️ У шортса и лонга РАЗНАЯ методика, и просить «полный сценарий ролика» под
    // шортс бессмысленно: он до минуты, решается в первые три секунды и живёт на
    // пересмотре. Раньше запрос был один на оба типа — по карточке шортса
    // ассистент писал сценарий длинного ролика.
    const short = d.kind === "short";
    const parts = short
      ? [
          `Напиши сценарий ШОРТСА (вертикальное видео до 60 секунд) по этой карточке контент-плана.`,
          ``,
          `Тема: ${d.titles[0] || "—"}`,
          d.previewTexts[0] ? `Текст на обложке: ${d.previewTexts[0]}` : "",
          d.opening ? `Заход (первая фраза): ${d.opening}` : "",
          d.pain ? `Боль ЦА: ${d.pain}` : "",
          d.whyWorks ? `Почему тема залетит: ${d.whyWorks}` : "",
          ``,
          `Хук в первые 3 секунды, без разгона и приветствий. Дальше плотный текст без ` +
            `воды — каждая фраза держит следующую. Финал закрывает мысль и работает на ` +
            `пересмотр. Реплики пиши так, как их произносить в кадр.`,
        ]
      : [
          `Напиши полный сценарий ролика по этой карточке контент-плана.`,
          ``,
          `Название: ${d.titles[0] || "—"}`,
          d.previewTexts[0] ? `Текст на превью: ${d.previewTexts[0]}` : "",
          fmt ? `Формат: ${fmt}${d.noSpeaker ? " (без спикера, озвучка чужого видео)" : ""}` : "",
          d.huntStage ? `Стадия лестницы Ханта: ${d.huntStage}` : "",
          d.pain ? `Боль ЦА: ${d.pain}` : "",
          d.whyWorks ? `Почему тема залетит: ${d.whyWorks}` : "",
          d.opening ? `Опенинг: ${d.opening}` : "",
          d.questions.length
            ? `\nСкелет ролика (вопросы):\n${d.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`
            : "",
          d.nativeClose ? `\nНативное закрытие: ${d.nativeClose}` : "",
        ];
    const filled = parts.filter(Boolean);

    // ⚠️ Референс подтягиваем ЖИВЫМИ данными, а не отдаём одной ссылкой: открыть
    // её модель не может, и раньше «разбор референса» сводился к гаданию по
    // названию. Теперь в промпт уходит описание автора (часто с тайм-кодами =
    // структурой) и реакция зрителей. ~3 units квоты YouTube, кэш на сервере 6 ч.
    // ⚠️⚠️ Всё, что дописываем ниже, идёт в `filled`, а НЕ в `parts`. Раньше
    // разбор референса пушился в `parts`, строка нессылочного референса — в
    // `filled`, а в чат уходил `parts`: то есть референс-не-ссылка терялся
    // ЦЕЛИКОМ, а в промпт заодно уезжали пустые строки от невыбранных полей.
    // Это и был баг «ссылка на референс не прикрепляется».
    const refId = d.reference ? videoIdFromUrl(d.reference) : null;
    if (d.reference) {
      // ⚠️ Ссылку даём ВСЕГДА и отдельной строкой: в insightPromptBlock её нет
      // (там только название, метрики, описание и комментарии), а человек в
      // ответе ждёт, что ассистент сошлётся на конкретный ролик-донор.
      const url = referenceUrl(d.reference);
      filled.push(`\nРеференс (видео-донор): ${referenceTitle(d.reference)}`);
      if (url) filled.push(`Ссылка на референс: ${url}`);

      if (refId) {
        setLoadingRef(true);
        const res = await apiVideoInsight(projectId, refId);
        setLoadingRef(false);
        // Не достали (ролик удалён, кончилась квота) — переход не срываем:
        // остаётся строка с названием и ссылкой, как минимум.
        if (res.ok) filled.push(`\n${insightPromptBlock(res.data.insight)}`);
      }
    }

    dispatch(prefillInput(filled.join("\n")));
    router.push(`/${projectId}/chat`);
  };

  const lines = (arr: string[]) => arr.join("\n");
  const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  // Выбранное название = titles[0]. Селектор переносит выбранный вариант вперёд,
  // поэтому выбор сохраняется (карточка на доске показывает именно его).
  const selectTitle = (val: string | null) => {
    if (!val) return;
    const rest = d.titles.filter((t) => t !== val);
    set("titles", [val, ...rest]);
  };
  const editTitle = (val: string) => set("titles", [val, ...d.titles.slice(1)]);

  return (
    <Drawer
      opened={opened}
      onClose={closeAndFlush}
      position="right"
      size="lg"
      radius="md"
      classNames={{ body: "cp-drawer" }}
      title={
        <Group gap={8} wrap="nowrap">
          <Text fw={700} lineClamp={1}>
            {d.titles[0] || "Ролик"}
          </Text>
          {saved && (
            <Group gap={3} wrap="nowrap" c="teal">
              <IconCheck size={14} />
              <Text size="xs">сохранено</Text>
            </Group>
          )}
        </Group>
      }
    >
      <Stack gap="lg">
        {/* Свалка + ссылка на чужой ролик = можно сразу переработать по методике:
            сервер разберёт донора, вытащит расшифровку и заполнит ВСЕ поля
            карточки. ⚠️ Показываем только в свалке: у карточки, над которой уже
            работают, поля заполнены руками, и затирать их кнопкой нельзя. */}
        {d.status === "dump" && refIdOf(d.reference) && (
          <Box>
            <Button
              fullWidth
              color="brand"
              variant="light"
              leftSection={<IconSparkles size={16} />}
              loading={adapting}
              onClick={() => void adapt()}
            >
              Разобрать по методике · {CONTENT_PLAN_ADAPT_QUOTA_COST}
            </Button>
            <Text size="xs" c="dimmed" mt={4}>
              Соберу из этого ролика свою карточку: названия по ВИСП, боль, скелет,
              опенинг. Разберу его цифры и расшифровку — чужой заголовок копировать
              не буду. Запись из свалки при этом заменится готовой карточкой.
            </Text>
            {adaptError && (
              <Text size="xs" c="red" mt={4}>
                {adaptError}
              </Text>
            )}
          </Box>
        )}

        {/* Статус */}
        <Box>
          <Text className="cp-label">Статус</Text>
          <Group gap={6}>
            {STATUSES.map((s) => {
              const m = STATUS_META[s];
              const active = d.status === s;
              return (
                <Button
                  key={s}
                  size="xs"
                  radius="xl"
                  variant={active ? "filled" : "light"}
                  color={m.color}
                  onClick={() => changeStatus(s)}
                >
                  {m.label}
                </Button>
              );
            })}
          </Group>
        </Box>

        <Button
          color="brand"
          leftSection={<IconMessageCircle size={16} />}
          onClick={() => void toScript()}
          loading={loadingRef}
        >
          Сгенерировать сценарий
        </Button>

        <Divider />

        {/* Связь с реальным роликом канала */}
        <Box>
          <Text className="cp-label">Ролик на канале</Text>
          {d.youtubeVideoId ? (
            <Group gap="sm" wrap="nowrap">
              {d.thumbnail && (
                <img src={ytImage(d.thumbnail) ?? undefined} alt="" style={{ width: 92, borderRadius: 6 }} />
              )}
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm">Привязан</Text>
                {d.views != null && (
                  <Text size="xs" c="dimmed">
                    {d.views.toLocaleString("ru-RU")} просмотров
                  </Text>
                )}
              </Box>
              <Button size="xs" variant="subtle" color="gray" onClick={() => link(null)}>
                Отвязать
              </Button>
            </Group>
          ) : (
            <Group gap="xs">
              <Button
                size="xs"
                variant="light"
                color="brand"
                leftSection={<IconLink size={15} />}
                onClick={() => setLinkOpen(true)}
              >
                Привязать ролик с канала
              </Button>
              <Text size="xs" c="dimmed">
                статус станет «опубликовано»
              </Text>
            </Group>
          )}
        </Box>

        {/* Референс (видео-донор). Раньше это было безымянное поле в самом низу
            формы, и положенный из раздела «Референсы» ролик было буквально не
            видно. Теперь это карточка ролика: превью + название ссылкой.
            ⚠️ Превью берём с i.ytimg.com по id из ссылки — БЕЗ похода в API
            (адрес превью выводится из id, это не стоит ни одного unit квоты).
            ⚠️ Поля для ручного ввода тут нет намеренно: референс кладётся кнопкой
            из раздела «Референсы», руками его никто не печатает. */}
        <Box>
          <Text className="cp-label">Референс (видео-донор)</Text>
          {d.reference ? (
            <Group gap="sm" wrap="nowrap" align="flex-start">
              {referenceThumb(d.reference) && (
                <Anchor
                  href={referenceUrl(d.reference) ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  style={{ flexShrink: 0, lineHeight: 0 }}
                >
                  <img
                    src={referenceThumb(d.reference) as string}
                    alt=""
                    width={132}
                    style={{ borderRadius: 8, display: "block", aspectRatio: "16 / 9", objectFit: "cover" }}
                  />
                </Anchor>
              )}
              <Box style={{ flex: 1, minWidth: 0 }}>
                {referenceUrl(d.reference) ? (
                  <Anchor
                    href={referenceUrl(d.reference) as string}
                    target="_blank"
                    rel="noreferrer"
                    size="sm"
                    lineClamp={3}
                  >
                    {referenceTitle(d.reference)}
                  </Anchor>
                ) : (
                  <Text size="sm" lineClamp={3}>
                    {d.reference}
                  </Text>
                )}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  mt={6}
                  leftSection={<IconX size={13} />}
                  onClick={() => set("reference", "")}
                >
                  Убрать референс
                </Button>
              </Box>
            </Group>
          ) : (
            <Text size="xs" c="dimmed">
              Не задан. Кладётся кнопкой на карточке ролика в разделе «Референсы» —
              там же видно, что у конкурентов залетело.
            </Text>
          )}
        </Box>

        {/* Переделка частей карточки ИИ */}
        <Box>
          <Group gap={6} align="baseline" mb={8}>
            <Text className="cp-label" mb={0}>
              Переделать с ИИ
            </Text>
            <Text size="xs" c="dimmed">
              · {CONTENT_PLAN_EDIT_QUOTA_COST} запрос за часть
            </Text>
          </Group>
          <Group gap={6} wrap="wrap">
            {REGEN_PARTS.map((p) => (
              <Button
                key={p}
                size="compact-xs"
                variant="default"
                leftSection={<IconRefresh size={13} />}
                loading={regen === p}
                disabled={regen !== null && regen !== p}
                onClick={() => regenerate(p)}
              >
                {REGEN_LABEL[p]}
              </Button>
            ))}
          </Group>
        </Box>

        <Divider />

        {/* Название: селектор вариантов + правка выбранного */}
        <Box>
          <Text className="cp-label">Название видео</Text>
          {d.titles.length > 1 && (
            <Select
              data={d.titles.map((t) => ({ value: t, label: t }))}
              value={d.titles[0] ?? null}
              onChange={selectTitle}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true }}
              mb="xs"
              placeholder="Выбери вариант"
            />
          )}
          <Textarea
            autosize
            minRows={2}
            value={d.titles[0] ?? ""}
            onChange={(e) => editTitle(e.currentTarget.value)}
            placeholder="Название ролика"
          />
          <Text size="xs" c="dimmed" mt={4}>
            {d.titles.length > 1
              ? "Выбранный вариант показывается на карточке — правь его прямо тут"
              : "Нажми «названия» в блоке «Переделать с ИИ», чтобы получить варианты"}
          </Text>
        </Box>

        <Textarea
          label="Текст на превью (варианты по строкам)"
          autosize
          minRows={1}
          value={lines(d.previewTexts)}
          onChange={(e) => set("previewTexts", toLines(e.currentTarget.value).slice(0, 3))}
        />

        <Group align="center" gap="md" grow>
          <Select
            label="Формат"
            data={Object.entries(FORMAT_META).map(([k, m]) => ({ value: k, label: m.label }))}
            value={d.format}
            onChange={(val) => set("format", (val as VideoFormat) || null)}
            clearable
          />
          {/* Свитч центрируем по высоте относительно селекта (раньше прижимался вниз) */}
          <Box style={{ display: "flex", alignItems: "center", height: "100%", paddingTop: 22 }}>
            <Switch
              label="Без спикера"
              checked={d.noSpeaker}
              onChange={(e) => set("noSpeaker", e.currentTarget.checked)}
            />
          </Box>
        </Group>

        {/* Лестница Ханта + подсказка (?) */}
        <Box>
          <Group gap={6} align="center" mb={8}>
            <Text className="cp-label" mb={0}>
              Лестница Ханта (стадия)
            </Text>
            <Popover width={340} withArrow position="top-start" shadow="md">
              <Popover.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  radius="xl"
                  aria-label="Как строится лестница Ханта"
                >
                  <IconHelpCircle size={16} />
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown>
                <Text size="sm" fw={600} mb={6}>
                  Стадии осознанности зрителя
                </Text>
                <List size="sm" spacing={4}>
                  {HUNT_LADDER_HINT.map((line, i) => (
                    <List.Item key={i}>{line}</List.Item>
                  ))}
                </List>
                <Text size="xs" c="dimmed" mt={8}>
                  Большинство охватных роликов — стадии 2 и 4.
                </Text>
              </Popover.Dropdown>
            </Popover>
          </Group>
          <TextInput
            value={d.huntStage ?? ""}
            onChange={(e) => set("huntStage", e.currentTarget.value)}
            placeholder="например: есть проблема, не знает о ней"
          />
        </Box>

        <Textarea
          label="Боль ЦА (от первого лица)"
          autosize
          minRows={1}
          value={d.pain ?? ""}
          onChange={(e) => set("pain", e.currentTarget.value)}
        />

        <Textarea
          label="10 вопросов (скелет ролика, по одному в строке)"
          autosize
          minRows={4}
          value={lines(d.questions)}
          onChange={(e) => set("questions", toLines(e.currentTarget.value).slice(0, 10))}
        />

        <Box>
          <Text className="cp-label">ВИСП (какие рычаги зажёг заголовок)</Text>
          <Group gap="md">
            {(["v", "i", "s", "p"] as const).map((k) => (
              <Checkbox
                key={k}
                label={{ v: "Выгода", i: "Интрига", s: "Срочность", p: "Причастность" }[k]}
                checked={d.visp?.[k] ?? false}
                onChange={(e) =>
                  set("visp", {
                    v: d.visp?.v ?? false,
                    i: d.visp?.i ?? false,
                    s: d.visp?.s ?? false,
                    p: d.visp?.p ?? false,
                    [k]: e.currentTarget.checked,
                  })
                }
              />
            ))}
          </Group>
        </Box>

        <Textarea
          label="Нативное закрытие"
          autosize
          minRows={1}
          value={d.nativeClose ?? ""}
          onChange={(e) => set("nativeClose", e.currentTarget.value)}
        />
        <TextInput
          label="Почему тема залетит"
          value={d.whyWorks ?? ""}
          onChange={(e) => set("whyWorks", e.currentTarget.value)}
        />
        <Textarea
          label="Опенинг (первый крючок)"
          autosize
          minRows={1}
          value={d.opening ?? ""}
          onChange={(e) => set("opening", e.currentTarget.value)}
        />

        <Divider />

        <Group justify="space-between">
          {confirmDel ? (
            <Group gap={6}>
              <Text size="sm">Удалить ролик?</Text>
              <Button size="xs" color="red" onClick={del}>
                Да
              </Button>
              <Button size="xs" variant="default" onClick={() => setConfirmDel(false)}>
                Нет
              </Button>
            </Group>
          ) : (
            <Tooltip label="Удалить ролик" withArrow>
              <ActionIcon
                variant="light"
                color="red"
                onClick={() => setConfirmDel(true)}
                aria-label="Удалить"
              >
                <IconTrash size={17} />
              </ActionIcon>
            </Tooltip>
          )}
          <Text size="xs" c="dimmed">
            Изменения сохраняются сами
          </Text>
        </Group>
      </Stack>

      <LinkVideoModal
        projectId={projectId}
        opened={linkOpen}
        onClose={() => setLinkOpen(false)}
        planTitle={d.titles[0] || ""}
        onPick={(picked) => link(picked)}
      />
    </Drawer>
  );
}
