"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconMessageCircle, IconMessages, IconRefresh } from "@tabler/icons-react";
import { useAppSelector } from "@/store/hooks";
import { questionsPrompt, type AudienceQuestionsResult } from "@/lib/audience-questions";

// «О чём спрашивают зрители» — темы, собранные из комментариев под своими роликами.
//
// ⚠️ Зачем это в разделе «Канал», а не отдельной страницей: это диагностика того же
// класса, что матрица и очередь на переделку, — «про что снимать дальше» на основе
// реальных данных канала, а не догадок. И главное: боли тут написаны словами
// зрителей, а не выведены моделью из брифа — ровно это лечит «средние по интернету»
// темы (Антипаттерн №15).
//
// ⚠️ Собирается ПО КНОПКЕ: под капотом запрос комментариев на каждый ролик, и
// делать это при каждом заходе в раздел незачем.
const CHAT_DRAFT_KEY = "creative-chat:chat-draft-v1";

export default function AudienceQuestions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const userId = useAppSelector((s) => s.auth.user?.id ?? "");
  const [result, setResult] = useState<AudienceQuestionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/channel/questions?projectId=${encodeURIComponent(projectId)}${refresh ? "&refresh=1" : ""}`
      );
      const data = (await res.json()) as { result?: AudienceQuestionsResult; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Не удалось собрать вопросы");
        return;
      }
      setResult(data.result ?? null);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setLoading(false);
    }
  };

  // Тот же механизм, что у остальных кнопок раздела: кладём готовый запрос
  // черновиком в чат и переходим туда.
  const askAssistant = () => {
    if (!result) return;
    try {
      localStorage.setItem(
        CHAT_DRAFT_KEY,
        JSON.stringify({ userId, text: questionsPrompt(result) })
      );
    } catch {
      /* приватный режим — не критично, просто откроется пустой чат */
    }
    router.push(`/${projectId}/chat`);
  };

  return (
    <Paper className="an-surface" p="md">
      <Group justify="space-between" align="center" mb="xs" wrap="wrap" gap="xs">
        <Group gap="xs">
          <IconMessages size={18} />
          <Title order={4} fz="md">
            О чём спрашивают зрители
          </Title>
        </Group>
        <Group gap="xs">
          {result && (
            <Button
              size="compact-sm"
              variant="subtle"
              leftSection={<IconRefresh size={14} />}
              onClick={() => void load(true)}
              loading={loading}
            >
              Обновить
            </Button>
          )}
          {!result && (
            <Button size="compact-sm" onClick={() => void load()} loading={loading}>
              Собрать
            </Button>
          )}
        </Group>
      </Group>

      {!result && !loading && !error && (
        <Text size="sm" c="dimmed">
          Разберу комментарии под последними роликами и покажу, что зрители спрашивают чаще
          всего. Это готовые темы их словами — не догадки про нишу.
        </Text>
      )}

      {loading && !result && (
        <Group gap="xs" py="sm">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Читаю комментарии…
          </Text>
        </Group>
      )}

      {error && (
        <Alert color="orange" variant="light">
          {error}
        </Alert>
      )}

      {result && result.topics.length === 0 && (
        // ⚠️ Пустой результат — не поломка: под роликами может не быть вопросов
        // вовсе (мало комментариев, отключены, одни благодарности).
        <Text size="sm" c="dimmed">
          Вопросов под роликами пока не нашлось: разобрано {result.videosScanned} роликов,
          подходящих комментариев {result.total}. Это бывает, когда комментариев мало или в
          них одни благодарности.
        </Text>
      )}

      {result && result.topics.length > 0 && (
        <Stack gap="sm">
          <Text size="xs" c="dimmed">
            Разобрано роликов: {result.videosScanned}, вопросов найдено: {result.total}.
          </Text>

          <Stack gap="xs">
            {result.topics.map((t) => (
              <Paper key={t.keyword} p="xs" radius="md" bg="var(--mantine-color-default)">
                <Group gap="xs" mb={4} wrap="nowrap">
                  <Badge size="sm" color="brand" variant="light">
                    {t.count}×
                  </Badge>
                  <Text size="sm" fw={600}>
                    {t.keyword}
                  </Text>
                </Group>
                <Stack gap={2}>
                  {t.examples.slice(0, 2).map((e, i) => (
                    <Text key={i} size="xs" c="dimmed" lineClamp={2} title={e.videoTitle}>
                      «{e.text}»
                    </Text>
                  ))}
                </Stack>
              </Paper>
            ))}
          </Stack>

          <Button
            variant="light"
            color="brand"
            leftSection={<IconMessageCircle size={16} />}
            onClick={askAssistant}
          >
            Сделать из этого темы роликов
          </Button>
        </Stack>
      )}
    </Paper>
  );
}
