"use client";

import { ytImage } from "@/lib/image-proxy";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconBrandInstagram,
  IconEye,
  IconHeart,
  IconMessageCircle2,
  IconBookmark,
  IconShare3,
  IconRefresh,
} from "@tabler/icons-react";
import {
  VERDICT_COLOR,
  VERDICT_LABEL,
  compareToUsual,
  engagementRate,
  formatSeconds,
  formatShare,
  median,
  retentionPercent,
  shareOf,
  type IgReel,
  type IgSnapshot,
} from "@/lib/instagram-types";
import { apiInstagramData } from "@/lib/instagram-client";
import { formatCount } from "@/lib/youtube-client";

// ── Раздел «Аналитика» для Instagram-проекта ────────────────────────────────
//
// Отвечает на один вопрос: где рилс потерял зрителя. Порядок блоков — порядок
// потери: сначала пропуски (не досмотрели даже трёх секунд), потом удержание
// (ушли по ходу), потом вовлечение (досмотрели, но не отреагировали).
//
// ⚠️ Чего здесь нет и не будет, потому что API не отдаёт: КРИВОЙ удержания по
// секундам (в приложении она есть, в API только число), источников просмотров,
// демографии по конкретному рилсу и динамики просмотров одного рилса по дням.
// Заглушек вместо них не рисуем — пустой график читается как поломка.
//
// ⚠️ Сравнение «лучше/хуже, чем обычно» считается по МЕДИАНЕ ваших же рилсов
// (compareToUsual), а не по рыночной норме: у каждого аккаунта своя база, и
// «хорошая» доля пропусков у одного — провал у другого.

const PERIODS = [
  { value: "7", label: "Неделя" },
  { value: "30", label: "Месяц" },
  { value: "90", label: "3 месяца" },
];

export default function InstagramDashboard() {
  const params = useParams();
  const projectId = typeof params.projectId === "string" ? params.projectId : "";

  const [snapshot, setSnapshot] = useState<IgSnapshot | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [notConnected, setNotConnected] = useState(false);

  const load = useCallback(
    async (refresh = false) => {
      if (!projectId) return;
      setLoading(true);
      setError(null);
      const res = await apiInstagramData({ projectId, days, refresh });
      setLoading(false);
      if (res.ok) {
        setSnapshot(res.data.snapshot);
        setNeedsReauth(false);
        setNotConnected(false);
        return;
      }
      setNeedsReauth(res.code === "IG_REAUTH");
      setNotConnected(res.code === "IG_NOT_CONNECTED");
      if (res.code !== "IG_NOT_CONNECTED") setError(res.error);
    },
    [projectId, days]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Медианы аккаунта — база для вердиктов «как обычно». Считаем один раз на снимок.
  const norms = useMemo(() => {
    const reels = snapshot?.reels ?? [];
    return {
      skip: reels.map((r) => r.skipRate).filter((x): x is number => x != null),
      retention: reels
        .map((r) => retentionPercent(r))
        .filter((x): x is number => x != null),
      engagement: reels
        .map((r) => engagementRate(r))
        .filter((x): x is number => x != null),
    };
  }, [snapshot]);

  if (notConnected) {
    return (
      <Stack gap="md" py="md">
        <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
          Аналитика
        </Title>
        <Paper className="an-surface" p="xl">
          <Stack align="center" gap="sm" ta="center">
            <IconBrandInstagram size={32} />
            <Text fw={700}>Аккаунт Instagram не подключён</Text>
            <Text size="sm" maw={440}>
              Подключите профессиональный аккаунт (Business или Creator) — и я покажу, где
              рилсы теряют зрителя: пропуски в первые секунды, удержание и вовлечение.
            </Text>
            <Button component={Link} href={`/${projectId}/settings`} color="brand" mt="xs">
              В настройки проекта
            </Button>
          </Stack>
        </Paper>
      </Stack>
    );
  }

  return (
    <Stack gap="lg" py="md">
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Box>
          <Title order={2} fz={{ base: "1.35rem", sm: "1.75rem" }}>
            Аналитика
          </Title>
          {snapshot && (
            <Text c="dimmed" size="sm" mt={4}>
              @{snapshot.account.username} · {formatCount(snapshot.account.followers)}{" "}
              подписчиков · рилсов за период: {snapshot.reels.length}
            </Text>
          )}
        </Box>
        <Group gap="sm">
          <SegmentedControl
            size="xs"
            radius="md"
            color="brand"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            data={PERIODS}
            disabled={loading}
          />
          <Button
            variant="default"
            size="xs"
            leftSection={<IconRefresh size={14} />}
            onClick={() => void load(true)}
            loading={loading}
          >
            Обновить
          </Button>
        </Group>
      </Group>

      {needsReauth && (
        <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
          Доступ к Instagram истёк — подключите аккаунт заново в настройках проекта.{" "}
          <Link href={`/${projectId}/settings`}>Открыть настройки</Link>
        </Alert>
      )}
      {error && !needsReauth && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />}>
          {error}
        </Alert>
      )}

      {loading && !snapshot ? (
        <Stack gap="md">
          <Skeleton h={120} radius="md" />
          <Skeleton h={240} radius="md" />
        </Stack>
      ) : snapshot && snapshot.reels.length === 0 ? (
        <Paper className="an-surface" p="xl">
          <Text ta="center" c="dimmed" size="sm">
            За выбранный период рилсов не выходило. Возьмите окно пошире.
          </Text>
        </Paper>
      ) : (
        snapshot && (
          <>
            <AccountSummary snapshot={snapshot} />
            <Stack gap="md">
              {snapshot.reels.map((r) => (
                <ReelCard key={r.id} reel={r} norms={norms} />
              ))}
            </Stack>
          </>
        )
      )}
    </Stack>
  );
}

// Итог по периоду: медианы, а не средние. Один залетевший рилс сдвигает среднее
// так, что оно перестаёт описывать «обычный» рилс аккаунта.
function AccountSummary({ snapshot }: { snapshot: IgSnapshot }) {
  const reels = snapshot.reels;
  const skip = median(reels.map((r) => r.skipRate).filter((x): x is number => x != null));
  const watch = median(
    reels.map((r) => r.avgWatchTime).filter((x): x is number => x != null)
  );
  const eng = median(
    reels.map((r) => engagementRate(r)).filter((x): x is number => x != null)
  );
  const views = reels.reduce((a, r) => a + (r.views ?? 0), 0);

  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
      <SummaryTile label="Просмотров за период" value={formatCount(views)} />
      <SummaryTile
        label="Смотрят в среднем"
        value={watch ? formatSeconds(watch) : "—"}
        hint="Медиана по рилсам периода"
      />
      <SummaryTile
        label="Пропускают за 3 сек"
        value={skip ? formatShare(skip) : "—"}
        hint="Чем ниже, тем лучше зашёл хук"
      />
      <SummaryTile
        label="Вовлечение"
        value={eng ? formatShare(eng) : "—"}
        hint="Лайки + комментарии + сохранения + репосты от охвата"
      />
    </SimpleGrid>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const tile = (
    <Paper className="an-surface" p="md">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz="1.5rem" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Paper>
  );
  return hint ? (
    <Tooltip label={hint} withArrow multiline w={240}>
      {tile}
    </Tooltip>
  ) : (
    tile
  );
}

function ReelCard({
  reel,
  norms,
}: {
  reel: IgReel;
  norms: { skip: number[]; retention: number[]; engagement: number[] };
}) {
  const retention = retentionPercent(reel);
  const eng = engagementRate(reel);
  // ⚠️ У пропусков «лучше» — это МЕНЬШЕ, поэтому higherIsBetter=false.
  const skipVerdict = compareToUsual(reel.skipRate, norms.skip, false);
  const retVerdict = compareToUsual(retention, norms.retention);
  const engVerdict = compareToUsual(eng, norms.engagement);

  const title = reel.caption.split("\n")[0]?.trim() || "Рилс без подписи";

  return (
    <Paper className="an-surface" p="md">
      <Group align="flex-start" wrap="nowrap" gap="md">
        {reel.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ytImage(reel.thumbnail) ?? undefined}
            alt=""
            style={{
              width: 84,
              aspectRatio: "9 / 16",
              objectFit: "cover",
              borderRadius: 10,
              flexShrink: 0,
            }}
          />
        )}

        <Box style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
            <Text fw={600} lineClamp={2} title={title}>
              {title}
            </Text>
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
              {reel.timestamp ? new Date(reel.timestamp).toLocaleDateString("ru-RU") : ""}
            </Text>
          </Group>

          <Group gap="lg" mt={8} wrap="wrap">
            <Metric icon={<IconEye size={14} />} value={formatCount(reel.views ?? 0)} />
            <Metric icon={<IconHeart size={14} />} value={formatCount(reel.likes ?? 0)} />
            <Metric icon={<IconMessageCircle2 size={14} />} value={formatCount(reel.comments ?? 0)} />
            <Metric icon={<IconBookmark size={14} />} value={formatCount(reel.saved ?? 0)} />
            <Metric icon={<IconShare3 size={14} />} value={formatCount(reel.shares ?? 0)} />
          </Group>

          {/* Три показателя в порядке потери зрителя: не начал смотреть →
              ушёл по ходу → досмотрел, но не отреагировал. */}
          <Stack gap={10} mt="md">
            <Row
              label="Пропустили за 3 секунды"
              value={formatShare(reel.skipRate)}
              percent={reel.skipRate}
              verdict={skipVerdict}
              invert
              hint="Сколько людей смахнули рилс в первые три секунды. Чем ниже, тем лучше сработал хук."
            />
            <Row
              label="В среднем досмотрено"
              value={
                retention != null
                  ? formatShare(retention)
                  : formatSeconds(reel.avgWatchTime)
              }
              percent={retention}
              verdict={retVerdict}
              hint={
                retention != null
                  ? "Среднее время просмотра к длительности рилса."
                  : "Instagram не отдал длительность рилса — показываю среднее время просмотра в секундах."
              }
            />
            <Row
              label="Вовлечение"
              value={formatShare(eng)}
              percent={eng}
              verdict={engVerdict}
              hint="Лайки, комментарии, сохранения и репосты от охвата — вместе, а не по отдельности."
            />
          </Stack>
        </Box>
      </Group>
    </Paper>
  );
}

function Metric({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <Group gap={5} wrap="nowrap">
      {icon}
      <Text size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Text>
    </Group>
  );
}

function Row({
  label,
  value,
  percent,
  verdict,
  hint,
  invert,
}: {
  label: string;
  value: string;
  percent: number | null;
  verdict: "better" | "usual" | "worse" | null;
  hint: string;
  /** У пропусков шкала перевёрнута: длинная полоса — плохо. */
  invert?: boolean;
}) {
  const color = verdict ? VERDICT_COLOR[verdict] : invert ? "red" : "brand";
  return (
    <Box>
      <Group justify="space-between" gap="sm" wrap="nowrap" mb={4}>
        <Tooltip label={hint} withArrow multiline w={280}>
          <Text size="sm" style={{ cursor: "help" }}>
            {label}
          </Text>
        </Tooltip>
        <Group gap={8} wrap="nowrap">
          <Text fw={700} size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
            {value}
          </Text>
          {/* Вердикт словами, а не только цветом: цвет один не должен нести смысл. */}
          {verdict && (
            <Badge size="xs" variant="light" color={VERDICT_COLOR[verdict]} radius="sm">
              {VERDICT_LABEL[verdict]}
            </Badge>
          )}
        </Group>
      </Group>
      <Progress
        value={percent != null ? Math.min(100, Math.max(0, percent)) : 0}
        color={color}
        size="sm"
        radius="xl"
      />
    </Box>
  );
}
