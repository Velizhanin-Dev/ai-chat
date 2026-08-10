"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  List,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconChartRadar,
  IconCircleCheck,
  IconHistory,
  IconInfoCircle,
  IconSparkles,
} from "@tabler/icons-react";
import { useAppDispatch } from "@/store/hooks";
import { bumpRequestsUsed } from "@/store/authSlice";
import { apiChannelAnalyses, apiDiagnoseChannel } from "@/lib/youtube-client";
import { paramsFor, kindLabel, periodLabelFull } from "@/lib/channel-params";
import { DIAGNOSE_PERIODS, type ChannelAnalysisRow, type DiagnoseKind } from "@/lib/youtube-types";
import ParamWheel, { verdictColor } from "./ParamWheel";

// Разбор канала по параметрам органического продвижения. Круг с секторами
// (каждый параметр — балл 0-100), детали по клику, история прошлых разборов.
// Новый разбор тратит 1 запрос квоты, поэтому по умолчанию показываем последний
// сохранённый, а не гоним модель заново.

const KIND_OPTIONS = [
  { value: "all", label: "Весь канал" },
  { value: "long", label: "Видео" },
  { value: "shorts", label: "Шортсы" },
];
const PERIOD_OPTIONS = DIAGNOSE_PERIODS.map((d) => ({
  value: String(d),
  label: d === 0 ? "Всё время" : d === 365 ? "Год" : `${d} дн.`,
}));

// Пока модель считает (40-90 секунд) — крутим живые статусы, а не мёртвый спиннер.
const RUN_STAGES = [
  "Поднимаю цифры канала из YouTube",
  "Считаю удержание и первые секунды",
  "Смотрю, откуда приходит трафик",
  "Сверяю с нормами по методике",
  "Собираю разбор",
];

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

function verdictLabel(v: "good" | "ok" | "bad"): string {
  return v === "good" ? "в норме" : v === "bad" ? "проседает" : "средне";
}

interface Props {
  projectId: string;
  opened: boolean;
  onClose: () => void;
  // Открыть тарифы, когда упёрлись в квоту (как в чате).
  onUpgrade?: () => void;
}

export default function ChannelDiagnostics({ projectId, opened, onClose, onUpgrade }: Props) {
  const dispatch = useAppDispatch();
  const isMobile = useMediaQuery("(max-width: 48em)");

  const [history, setHistory] = useState<ChannelAnalysisRow[] | null>(null);
  const [current, setCurrent] = useState<ChannelAnalysisRow | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<DiagnoseKind>("all");
  const [periodDays, setPeriodDays] = useState<number>(28);
  const [ctr, setCtr] = useState<string | number>("");

  // История разборов (квоту не тратит) — при открытии показываем последний.
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setError(null);
    apiChannelAnalyses(projectId).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setHistory([]);
        setError(res.error);
        return;
      }
      setHistory(res.data);
      const last = res.data[0] ?? null;
      setCurrent(last);
      if (last) {
        setKind(last.kind);
        setPeriodDays(last.periodDays);
      }
      setSelected(null);
    });
    return () => {
      alive = false;
    };
  }, [opened, projectId]);

  // Ротация статусов на время генерации.
  useEffect(() => {
    if (!running) {
      setStage(0);
      return;
    }
    const t = setInterval(() => setStage((s) => Math.min(s + 1, RUN_STAGES.length - 1)), 2600);
    return () => clearInterval(t);
  }, [running]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const manualCtr = typeof ctr === "number" ? ctr : ctr ? Number(String(ctr).replace(",", ".")) : null;
    const res = await apiDiagnoseChannel({
      projectId,
      kind,
      periodDays,
      manualCtr: Number.isFinite(manualCtr as number) ? (manualCtr as number) : null,
    });
    setRunning(false);
    if (!res.ok) {
      // Кончилась квота/подписка: если родитель умеет показать тарифы — отдаём ему,
      // иначе честно пишем причину прямо здесь.
      if ((res.code === "PLAN_EXPIRED" || res.code === "QUOTA_EXCEEDED") && onUpgrade) {
        onUpgrade();
        onClose();
        return;
      }
      setError(res.error);
      return;
    }
    dispatch(bumpRequestsUsed()); // остаток квоты в шапке не отстаёт
    setCurrent(res.data);
    setSelected(null);
    setHistory((h) => [res.data, ...(h ?? [])]);
  }, [ctr, dispatch, kind, onClose, onUpgrade, periodDays, projectId]);

  const specs = useMemo(() => paramsFor(current?.kind ?? kind), [current?.kind, kind]);
  const specByKey = useMemo(() => new Map(specs.map((s) => [s.key, s])), [specs]);
  const metricByKey = useMemo(
    () => new Map((current?.metrics.metrics ?? []).map((m) => [m.key, m])),
    [current]
  );
  const selectedParam = current?.result.params.find((p) => p.key === selected) ?? null;
  // Готовые значения («34 %») для тултипов круга.
  const wheelValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const m of current?.metrics.metrics ?? []) out[m.key] = m.display;
    return out;
  }, [current]);

  // Срез, который сейчас показан, отличается от выбранного в шапке — значит
  // «Разобрать» даст новый разбор, а не повторит текущий.
  const stale =
    !!current && (current.kind !== kind || current.periodDays !== periodDays);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon variant="light" color="brand" radius="md">
            <IconChartRadar size={18} />
          </ThemeIcon>
          <Text fw={600}>Разбор канала по параметрам продвижения</Text>
        </Group>
      }
      size="xl"
      radius="lg"
      fullScreen={isMobile}
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Stack gap="md">
        {/* Настройки среза */}
        <Paper withBorder radius="md" p="sm">
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Group gap="sm" wrap="wrap">
              <SegmentedControl
                size="xs"
                radius="md"
                color="brand"
                value={kind}
                onChange={(v) => setKind(v as DiagnoseKind)}
                data={KIND_OPTIONS}
                disabled={running}
                aria-label="Что разбираем"
              />
              <SegmentedControl
                size="xs"
                radius="md"
                color="brand"
                value={String(periodDays)}
                onChange={(v) => setPeriodDays(Number(v))}
                data={PERIOD_OPTIONS}
                disabled={running}
                aria-label="Период разбора"
              />
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Tooltip
                multiline
                w={260}
                withArrow
                label="CTR превью YouTube по API не отдаёт — он есть только в Studio. Введи цифру оттуда, и я разберу кликабельность по ней."
              >
                <NumberInput
                  size="xs"
                  w={140}
                  min={0}
                  max={100}
                  step={0.1}
                  decimalScale={1}
                  placeholder="CTR из Studio"
                  suffix=" %"
                  value={ctr}
                  onChange={setCtr}
                  disabled={running}
                  aria-label="CTR превью из YouTube Studio, проценты"
                />
              </Tooltip>
              <Button
                color="brand"
                size="sm"
                leftSection={<IconSparkles size={16} />}
                onClick={run}
                loading={running}
              >
                {current && !stale ? "Разобрать заново" : "Разобрать"}
              </Button>
            </Group>
          </Group>
          <Text size="xs" c="dimmed" mt={6}>
            {kindLabel(kind)}, {periodLabelFull(periodDays)}. Разбор тратит 1 запрос.
          </Text>
        </Paper>

        {error && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={16} />}>
            {error}
          </Alert>
        )}

        {running && (
          <Stack gap="xs" align="center" py="xl">
            <Loader color="brand" />
            <Text size="sm" c="dimmed" ta="center">
              {RUN_STAGES[stage]}…
            </Text>
            <Text size="xs" c="dimmed" ta="center">
              Обычно занимает до минуты.
            </Text>
          </Stack>
        )}

        {!running && history !== null && !current && (
          <EmptyState onRun={run} />
        )}

        {!running && current && (
          <>
            {stale && (
              <Alert color="brand" variant="light" icon={<IconInfoCircle size={16} />}>
                Показан разбор: {kindLabel(current.kind)}, {periodLabelFull(current.periodDays)}.
                Нажми «Разобрать», чтобы посчитать выбранный срез.
              </Alert>
            )}

            <Group align="flex-start" gap="xl" wrap="wrap">
              <Box style={{ flex: "1 1 320px", minWidth: 0 }}>
                <ParamWheel
                  params={current.result.params}
                  specs={paramsFor(current.kind)}
                  overall={current.overallScore}
                  selected={selected}
                  onSelect={(key) => setSelected((s) => (s === key ? null : key))}
                  values={wheelValues}
                  withLabels={!isMobile}
                  animKey={current.id}
                />
                <Text size="xs" c="dimmed" ta="center" mt={4}>
                  Разбор от {formatWhen(current.createdAt)} · {kindLabel(current.kind)},{" "}
                  {periodLabelFull(current.periodDays)}
                </Text>
              </Box>

              <Box style={{ flex: "1 1 300px", minWidth: 0 }}>
                {selectedParam ? (
                  <ParamDetails
                    verdict={selectedParam}
                    spec={specByKey.get(selectedParam.key)}
                    display={metricByKey.get(selectedParam.key)?.display}
                    note={metricByKey.get(selectedParam.key)?.note}
                    onBack={() => setSelected(null)}
                  />
                ) : (
                  <Summary row={current} />
                )}
              </Box>
            </Group>

            {/* Легенда: она же доступная альтернатива кругу и второй способ выбора. */}
            <Stack gap={4}>
              {current.result.params.map((p) => {
                const spec = paramsFor(current.kind).find((s) => s.key === p.key);
                const m = metricByKey.get(p.key);
                const isSel = selected === p.key;
                return (
                  <UnstyledButton
                    key={p.key}
                    className="yt-driver-row"
                    onClick={() => setSelected((s) => (s === p.key ? null : p.key))}
                    aria-pressed={isSel}
                  >
                    <Group gap="sm" wrap="nowrap">
                      <Box
                        w={10}
                        h={10}
                        style={{
                          borderRadius: 3,
                          background: `var(--mantine-color-${verdictColor(p.verdict)}-5)`,
                          flexShrink: 0,
                        }}
                      />
                      <Text size="sm" fw={isSel ? 600 : 500} style={{ flex: "1 1 auto", minWidth: 0 }}>
                        {spec?.label ?? p.key}
                      </Text>
                      <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                        {m?.display ?? "—"}
                      </Text>
                      <Progress
                        value={p.score}
                        color={verdictColor(p.verdict)}
                        size="sm"
                        radius="xl"
                        w={80}
                        style={{ flexShrink: 0 }}
                      />
                      <Text size="sm" fw={700} w={32} ta="right" style={{ flexShrink: 0 }}>
                        {p.score}
                      </Text>
                    </Group>
                  </UnstyledButton>
                );
              })}
            </Stack>

            {current.metrics.notes.length > 0 && (
              <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
                <Text size="xs" fw={600} mb={4}>
                  Что не удалось измерить
                </Text>
                <List size="xs" spacing={2}>
                  {current.metrics.notes.map((n, i) => (
                    <List.Item key={i}>{n}</List.Item>
                  ))}
                </List>
              </Alert>
            )}

            {history && history.length > 1 && (
              <>
                <Divider />
                <HistoryPicker
                  history={history}
                  currentId={current.id}
                  onPick={(row) => {
                    setCurrent(row);
                    setSelected(null);
                    setKind(row.kind);
                    setPeriodDays(row.periodDays);
                  }}
                />
              </>
            )}
          </>
        )}

        {!running && history === null && (
          <Stack align="center" py="xl">
            <Loader color="brand" size="sm" />
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

// ── Части ─────────────────────────────────────────────────────────────────────

function EmptyState({ onRun }: { onRun: () => void }) {
  return (
    <Stack align="center" gap="sm" py="xl">
      <ThemeIcon size={56} radius="xl" variant="light" color="brand">
        <IconChartRadar size={30} />
      </ThemeIcon>
      <Text fw={600}>Разберу канал по параметрам продвижения</Text>
      <Text size="sm" c="dimmed" ta="center" maw={460}>
        Подниму цифры канала, сверю каждый параметр с нормой и скажу, что чинить в первую
        очередь. Разбор сохранится — через месяц будет видно, что изменилось.
      </Text>
      <Button color="brand" leftSection={<IconSparkles size={16} />} onClick={onRun}>
        Разобрать канал
      </Button>
    </Stack>
  );
}

function Summary({ row }: { row: ChannelAnalysisRow }) {
  const r = row.result;
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Text fw={600}>Общий вывод</Text>
        <Badge color={r.overall >= 70 ? "teal" : r.overall >= 40 ? "brand" : "red"} variant="light">
          {r.overall} из 100
        </Badge>
      </Group>
      {r.summary && (
        <Text size="sm" style={{ whiteSpace: "pre-line" }}>
          {r.summary}
        </Text>
      )}
      {r.priority.length > 0 && (
        <Paper withBorder radius="md" p="sm">
          <Text size="sm" fw={600} mb={6}>
            За что взяться в первую очередь
          </Text>
          <List size="sm" spacing={6} icon={<IconCircleCheck size={16} color="var(--mantine-color-brand-6)" />}>
            {r.priority.map((p, i) => (
              <List.Item key={i}>{p}</List.Item>
            ))}
          </List>
        </Paper>
      )}
      <Text size="xs" c="dimmed">
        Нажми на сектор круга — покажу разбор по параметру.
      </Text>
    </Stack>
  );
}

function ParamDetails({
  verdict,
  spec,
  display,
  note,
  onBack,
}: {
  verdict: ChannelAnalysisRow["result"]["params"][number];
  spec?: { label: string; about: string; norm: string };
  display?: string;
  note?: string;
  onBack: () => void;
}) {
  const color = verdictColor(verdict.verdict);
  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text fw={600}>{spec?.label ?? verdict.key}</Text>
        <Badge color={color} variant="light" style={{ flexShrink: 0 }}>
          {verdict.score} · {verdictLabel(verdict.verdict)}
        </Badge>
      </Group>

      <Group gap="xs">
        <Text fz={28} fw={700} lh={1.1}>
          {display ?? "—"}
        </Text>
        {spec?.norm && (
          <Text size="xs" c="dimmed" style={{ flex: 1 }}>
            Норма: {spec.norm}
          </Text>
        )}
      </Group>

      {spec?.about && (
        <Text size="xs" c="dimmed">
          {spec.about}
        </Text>
      )}

      <Text size="sm">{verdict.fact}</Text>
      {verdict.why && (
        <Text size="sm" c="dimmed">
          {verdict.why}
        </Text>
      )}

      {verdict.todo.length > 0 && (
        <Paper withBorder radius="md" p="sm">
          <Text size="sm" fw={600} mb={6}>
            Что сделать
          </Text>
          <List size="sm" spacing={6}>
            {verdict.todo.map((t, i) => (
              <List.Item key={i}>{t}</List.Item>
            ))}
          </List>
        </Paper>
      )}

      {note && (
        <Text size="xs" c="dimmed">
          Как считали: {note}
        </Text>
      )}

      <Button variant="subtle" size="xs" onClick={onBack}>
        ← К общему выводу
      </Button>
    </Stack>
  );
}

function HistoryPicker({
  history,
  currentId,
  onPick,
}: {
  history: ChannelAnalysisRow[];
  currentId: string;
  onPick: (row: ChannelAnalysisRow) => void;
}) {
  return (
    <Group gap="sm" align="center" wrap="wrap">
      <Group gap={6}>
        <IconHistory size={16} />
        <Text size="sm" fw={600}>
          Прошлые разборы
        </Text>
      </Group>
      <Select
        size="xs"
        w={320}
        value={currentId}
        onChange={(v) => {
          const row = history.find((h) => h.id === v);
          if (row) onPick(row);
        }}
        data={history.map((h) => ({
          value: h.id,
          label: `${formatWhen(h.createdAt)} · ${kindLabel(h.kind)}, ${periodLabelFull(
            h.periodDays
          )} · ${h.overallScore}/100`,
        }))}
        comboboxProps={{ withinPortal: true }}
        aria-label="Выбрать прошлый разбор"
      />
    </Group>
  );
}
