"use client";

import { useState, useCallback } from "react";
import {
  Textarea,
  Button,
  Stack,
  Paper,
  Text,
  Alert,
  Box,
  CopyButton,
  ActionIcon,
  Tooltip,
  Group,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconCopy, IconWand } from "@tabler/icons-react";

export default function GenerateForm() {
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    const trimmed = topic.trim();
    if (!trimmed || isLoading) return;

    setError(null);
    setScript("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Ошибка сервера");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("Нет потока ответа");

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.token) {
              setScript((prev) => prev + parsed.token);
            }
            if (parsed.error) {
              throw new Error(parsed.error);
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Произошла ошибка");
    } finally {
      setIsLoading(false);
    }
  }, [topic, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  return (
    <Stack gap="md">
      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper shadow="sm" radius="md" withBorder p="md">
        <Stack gap="sm">
          <Textarea
            label="Тема видео"
            description="Напиши тему, и я напишу сценарий по методологии из базы знаний"
            placeholder="Например: как набрать первые 1000 подписчиков без бюджета"
            value={topic}
            onChange={(e) => setTopic(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            autosize
            minRows={2}
            maxRows={5}
            disabled={isLoading}
          />
          <Button
            leftSection={<IconWand size={16} />}
            onClick={handleGenerate}
            loading={isLoading}
            disabled={!topic.trim()}
          >
            Написать сценарий
          </Button>
        </Stack>
      </Paper>

      {(script || isLoading) && (
        <Paper shadow="sm" radius="md" withBorder p="md">
          <Group justify="space-between" mb="sm">
            <Text fw={600} size="sm">Сценарий</Text>
            {script && (
              <CopyButton value={script}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Скопировано" : "Скопировать"}>
                    <ActionIcon variant="light" color={copied ? "teal" : "gray"} onClick={copy}>
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            )}
          </Group>
          <Box>
            <Text
              size="sm"
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.7 }}
            >
              {script}
              {isLoading && (
                <span style={{ animation: "blink 1s step-end infinite" }}>▊</span>
              )}
            </Text>
          </Box>
        </Paper>
      )}
    </Stack>
  );
}
