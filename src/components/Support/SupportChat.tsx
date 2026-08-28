"use client";

import { useEffect, useRef, useState } from "react";
import {
  Box,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  ThemeIcon,
  ActionIcon,
} from "@mantine/core";
import { IconHeadset, IconSend, IconUser, IconPaperclip, IconX } from "@tabler/icons-react";
import type { SupportMessageRow, SupportRole } from "@/lib/support";
import {
  SUPPORT_MAX_LENGTH,
  SUPPORT_MAX_FILES,
  SUPPORT_MAX_FILE_BYTES,
} from "@/lib/support";

// Лента чата техподдержки + композер. Визуал — тот же, что в разделе «Чат»:
// бабблы .bubble-user / .bubble-assistant, композер .chat-composer, аватары
// скрыты на мобиле (баббл во всю ширину). Отличие от чата с ассистентом —
// нет стрима и markdown: обе стороны пишут обычный текст.
//
// Компонент презентационный: сообщения и отправку даёт родитель (окно
// пользователя или экран админки). `me` — чьи сообщения рисуем справа: у
// пользователя это "user", у админа — "admin".

interface Props {
  messages: SupportMessageRow[];
  me: SupportRole;
  loading?: boolean;
  sending?: boolean;
  onSend: (text: string, files: File[]) => void;
  placeholder?: string;
  // Что показать на пустой переписке (у юзера — приглашение написать).
  emptyState?: React.ReactNode;
  disabled?: boolean;
}

export default function SupportChat({
  messages,
  me,
  loading = false,
  sending = false,
  onSend,
  placeholder = "Опишите вопрос...",
  emptyState,
  disabled = false,
}: Props) {
  const [input, setInput] = useState("");
  // Выбранные, но ещё не отправленные картинки.
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // Превью выбранных файлов. ⚠️ objectURL обязательно освобождаем: без revoke
  // каждый выбранный скриншот висит в памяти вкладки до перезагрузки.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const addFiles = (incoming: File[]) => {
    const images = incoming.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    const tooBig = images.find((f) => f.size > SUPPORT_MAX_FILE_BYTES);
    if (tooBig) {
      setFileError("Картинка тяжелее 8 МБ — уменьшите или обрежьте");
      return;
    }
    setFileError(null);
    setFiles((cur) => {
      const next = [...cur, ...images].slice(0, SUPPORT_MAX_FILES);
      if (cur.length + images.length > SUPPORT_MAX_FILES) {
        setFileError(`Не больше ${SUPPORT_MAX_FILES} картинок за раз`);
      }
      return next;
    });
  };

  // Ctrl+V со скриншотом. ⚠️ Главный способ приложить картинку: человек жмёт
  // PrintScreen и сразу вставляет — сохранять во временный файл ради кнопки
  // «выбрать файл» никто не будет.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData?.files ?? []);
    if (pasted.length === 0) return;
    e.preventDefault();
    addFiles(pasted);
  };

  // Держим низ ленты: при открытии и на каждое новое сообщение.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [messages, loading]);

  const send = () => {
    const text = input.trim();
    // ⚠️ Сообщение из одной картинки — это нормально: человек кидает скриншот и
    // ждёт «что это?». Пустое во всех смыслах не отправляем.
    if ((!text && files.length === 0) || sending || disabled) return;
    onSend(text, files);
    setInput("");
    setFiles([]);
    setFileError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter — отправка, Shift+Enter — перенос строки (как в основном чате).
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <Box style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ScrollArea style={{ height: "100%" }} viewportRef={viewport}>
          <Stack gap="md" px={{ base: 4, sm: "md" }} py="md">
            {loading && messages.length === 0 && (
              <Center py={60}>
                <Loader color="brand" />
              </Center>
            )}

            {!loading && messages.length === 0 && emptyState}

            {messages.map((msg) => {
              const mine = msg.role === me;
              return (
                <Box
                  key={msg.id}
                  style={{
                    display: "flex",
                    // row-reverse инвертирует ось: чтобы прижать группу вправо,
                    // нужен flex-start (как в ChatWindow).
                    justifyContent: "flex-start",
                    gap: 8,
                    flexDirection: mine ? "row-reverse" : "row",
                    alignItems: "flex-start",
                  }}
                >
                  <ThemeIcon
                    size="lg"
                    radius="xl"
                    variant="light"
                    color={msg.role === "admin" ? "brand" : "gray"}
                    mt={4}
                    visibleFrom="sm"
                    style={{ flexShrink: 0 }}
                  >
                    {msg.role === "admin" ? (
                      <IconHeadset size={18} />
                    ) : (
                      <IconUser size={18} />
                    )}
                  </ThemeIcon>
                  <Paper
                    shadow="xs"
                    p="sm"
                    radius="md"
                    maw={{ base: "100%", sm: "78%" }}
                    className={mine ? "bubble-user" : "bubble-assistant"}
                    style={{ width: "fit-content" }}
                  >
                    {msg.content && (
                      <Text
                        size="sm"
                        style={{
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          color: "inherit",
                        }}
                      >
                        {msg.content}
                      </Text>
                    )}
                    {/* Вложения. Клик открывает оригинал в новой вкладке: в
                        баббле картинка мелкая, а разглядывать надо детали
                        интерфейса, ради которых скриншот и прислали. */}
                    {msg.attachments.length > 0 && (
                      <Group gap={6} mt={msg.content ? 8 : 0} wrap="wrap">
                        {msg.attachments.map((a) => (
                          <a
                            key={a.url}
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: "block", lineHeight: 0 }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={a.url}
                              alt="Вложение"
                              loading="lazy"
                              style={{
                                maxWidth: 220,
                                maxHeight: 220,
                                borderRadius: 8,
                                display: "block",
                              }}
                            />
                          </a>
                        ))}
                      </Group>
                    )}
                    <Text size="xs" c="dimmed" mt={4}>
                      {new Date(msg.createdAt).toLocaleString("ru-RU", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                  </Paper>
                </Box>
              );
            })}
          </Stack>
        </ScrollArea>
      </Box>

      {(previews.length > 0 || fileError) && (
        <Box px={{ base: 4, sm: "md" }} mt="xs">
          {fileError && (
            <Text size="xs" c="red" mb={previews.length ? 6 : 0}>
              {fileError}
            </Text>
          )}
          <Group gap={6} wrap="wrap">
            {previews.map((url, i) => (
              <Box key={url} style={{ position: "relative" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt=""
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: "cover",
                    borderRadius: 8,
                    display: "block",
                  }}
                />
                <ActionIcon
                  size="xs"
                  radius="xl"
                  variant="filled"
                  color="dark"
                  aria-label="Убрать картинку"
                  style={{ position: "absolute", top: -6, right: -6 }}
                  onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                >
                  <IconX size={12} />
                </ActionIcon>
              </Box>
            ))}
          </Group>
        </Box>
      )}

      <Group
        gap="xs"
        wrap="nowrap"
        align="flex-end"
        px={{ base: 4, sm: "md" }}
        className="chat-composer"
        mt="xs"
      >
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.currentTarget.files ?? []));
            // ⚠️ Сбрасываем значение: без этого повторный выбор ТОГО ЖЕ файла не
            // вызывает onChange, и человек думает, что кнопка сломалась.
            e.currentTarget.value = "";
          }}
        />
        <ActionIcon
          size="lg"
          radius="xl"
          variant="subtle"
          color="gray"
          onClick={() => picker.current?.click()}
          disabled={disabled || sending || files.length >= SUPPORT_MAX_FILES}
          aria-label="Прикрепить картинку"
          title="Прикрепить картинку (или вставьте скриншот через Ctrl+V)"
        >
          <IconPaperclip size={18} />
        </ActionIcon>
        <Textarea
          variant="unstyled"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          size="md"
          autosize
          minRows={2}
          maxRows={6}
          maxLength={SUPPORT_MAX_LENGTH}
          disabled={disabled || sending}
          style={{ flex: 1 }}
          styles={{ input: { paddingTop: 6, paddingBottom: 6, paddingLeft: 6 } }}
        />
        <ActionIcon
          size="xl"
          radius="xl"
          variant="filled"
          color="brand"
          onClick={send}
          disabled={(!input.trim() && files.length === 0) || sending || disabled}
          loading={sending}
          aria-label="Отправить"
        >
          <IconSend size={18} />
        </ActionIcon>
      </Group>
    </Box>
  );
}
