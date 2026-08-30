"use client";

import { useState } from "react";
import { Alert, Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconChartBar } from "@tabler/icons-react";
import { MAX_TOPICS, type TopicEvidence as Evidence } from "@/lib/topic-evidence";
import { formatCount } from "@/lib/youtube-client";

// Проверка тем плана реальной выдачей YouTube.
//
// ⚠️ Зачем это в контент-плане: без проверки любая тема — мнение модели, и спорить
// с ней нечем. С цифрами разговор другой: «по этой теме лучший ролик собрал 300
// тысяч» либо «по ней не снимает никто». Это превращает план из списка идей в
// набор решений с доказательством.
//
// ⚠️ Ни квоты тарифа, ни units YouTube: выдача читается мимо Data API. Поэтому
// кнопка не пугает ценой и её можно жать сколько угодно.
export default function TopicEvidencePanel({ topics }: { topics: string[] }) {
  const [items, setItems] = useState<Evidence[] | null>(null);
  // Сколько тем проверить не удалось (сбой чтения выдачи) — НЕ то же, что
  // «по теме пусто». Ловили на проде: сервис моргнул, и панель выдала «людям
  // такое почти не ищут» про заведомо живые темы.
  const [failed, setFailed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    if (loading || topics.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/topics/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics: topics.slice(0, MAX_TOPICS) }),
      });
      const data = (await res.json()) as {
        evidence?: Evidence[];
        failed?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Не удалось проверить темы");
        return;
      }
      setItems(data.evidence ?? []);
      setFailed(data.failed ?? 0);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setLoading(false);
    }
  };

  if (topics.length === 0) return null;

  return (
    <Paper className="an-surface" p="md">
      <Group justify="space-between" align="center" mb={items ? "sm" : 0} wrap="wrap" gap="xs">
        <Group gap="xs">
          <IconChartBar size={18} />
          <Text fw={600} size="sm">
            Проверить темы по нише
          </Text>
          <Text size="xs" c="dimmed">
            что уже снято по этим темам и сколько собрало
          </Text>
        </Group>
        <Button size="compact-sm" variant="light" onClick={() => void check()} loading={loading}>
          {items ? "Проверить заново" : "Проверить"}
        </Button>
      </Group>

      {error && (
        <Alert color="orange" variant="light">
          {error}
        </Alert>
      )}

      {/* ⚠️ Три разных пустых состояния, и путать их нельзя:
          сбой по ВСЕМ темам — честная ошибка (иначе сбой выдаёт себя за инсайт
          «тему не ищут», и человек выкидывает рабочие темы);
          сбой по ЧАСТИ — результат + приписка;
          настоящая пустота — прежний текст про узкие темы. */}
      {items && items.length === 0 && failed > 0 && !error && (
        <Alert color="orange" variant="light">
          Не получилось прочитать выдачу YouTube ({failed} {failed === 1 ? "тема" : "тем"}) —
          похоже, сервис сейчас недоступен. Это сбой, а не «темы никто не ищет»: попробуйте ещё
          раз через минуту.
        </Alert>
      )}

      {items && items.length === 0 && failed === 0 && !error && (
        <Text size="sm" c="dimmed">
          Выдача ничего не вернула. Так бывает по очень узким темам — это тоже сигнал: людям
          такое почти не ищут.
        </Text>
      )}

      {items && items.length > 0 && failed > 0 && (
        <Text size="xs" c="dimmed" mb={6}>
          {failed} {failed === 1 ? "тему" : "тем"} проверить не удалось — по остальным цифры
          ниже.
        </Text>
      )}

      {items && items.length > 0 && (
        <Stack gap="xs">
          {items.map((e) => (
            <Paper key={e.topic} p="xs" radius="md" bg="var(--mantine-color-default)">
              <Text size="sm" fw={600} lineClamp={1}>
                {e.topic}
              </Text>
              <Group gap="xs" mt={4} wrap="wrap">
                <Badge size="sm" variant="light" color="gray">
                  роликов: {formatCount(e.totalResults)}
                </Badge>
                <Badge size="sm" variant="light" color="brand">
                  медиана топа: {formatCount(e.medianViews)}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                {e.verdict}
              </Text>
              {/* Главное доказательство: конкретный ролик, который уже сработал. */}
              {e.best && (
                <Text size="xs" mt={2} lineClamp={1}>
                  Лучший: «{e.best.title}» — {formatCount(e.best.views)} просмотров,{" "}
                  {e.best.channelTitle}
                </Text>
              )}
            </Paper>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
