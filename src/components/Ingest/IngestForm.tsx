"use client";

import { useState, useCallback } from "react";
import {
  Textarea,
  TextInput,
  Button,
  Stack,
  Progress,
  Text,
  Alert,
  Paper,
  Group,
  Badge,
} from "@mantine/core";
import { Dropzone, MIME_TYPES } from "@mantine/dropzone";
import {
  IconUpload,
  IconFileTypePdf,
  IconFileText,
  IconX,
  IconCheck,
  IconAlertCircle,
} from "@tabler/icons-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  setUploading,
  setProgress,
  addDocument,
  setError,
  resetProgress,
} from "@/store/ingestSlice";
import axios from "axios";

export default function IngestForm() {
  const [text, setText] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const dispatch = useAppDispatch();
  const { isUploading, progress, progressLabel, error } = useAppSelector(
    (s) => s.ingest
  );

  const handleSubmitText = useCallback(async () => {
    if (!text.trim() && !selectedFile) return;

    dispatch(setUploading(true));
    dispatch(setError(null));
    dispatch(setProgress({ value: 10, label: "Подготовка данных..." }));

    try {
      let response;

      if (selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        if (speaker.trim()) formData.append("speaker", speaker.trim());
        dispatch(
          setProgress({ value: 30, label: "Загрузка файла и обработка..." })
        );

        response = await axios.post("/api/ingest", formData, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              const pct = Math.round(
                (progressEvent.loaded * 30) / progressEvent.total + 30
              );
              dispatch(
                setProgress({ value: pct, label: "Загрузка файла..." })
              );
            }
          },
        });
      } else {
        dispatch(
          setProgress({ value: 30, label: "Отправка текста на обработку..." })
        );
        response = await axios.post("/api/ingest", {
          text,
          source: "manual-input",
          speaker: speaker.trim() || undefined,
        });
      }

      dispatch(
        setProgress({ value: 90, label: "Сохранение в базу данных..." })
      );

      const { documentId, source, speaker: docSpeaker, chunksCount, createdAt } = response.data;
      dispatch(
        addDocument({
          id: documentId,
          source,
          speaker: docSpeaker || null,
          chunksCount,
          createdAt,
        })
      );

      dispatch(setProgress({ value: 100, label: "Готово!" }));

      setText("");
      setSpeaker("");
      setSelectedFile(null);

      setTimeout(() => dispatch(resetProgress()), 2000);
    } catch (err) {
      let message = "Ошибка загрузки";
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        message = err.response.data.error;
      } else if (err instanceof Error) {
        message = err.message;
      }
      dispatch(setError(message));
      dispatch(resetProgress());
    }
  }, [text, speaker, selectedFile, dispatch]);

  const handleDrop = (files: File[]) => {
    if (files.length > 0) {
      setSelectedFile(files[0]);
    }
  };

  return (
    <Stack gap="lg">
      <Paper shadow="xs" p="lg" radius="md" withBorder>
        <Stack gap="md">
          <Text fw={600} size="lg">
            Имя спикера
          </Text>
          <TextInput
            placeholder="Например: Николай Велижанин"
            description="Бот будет отвечать в стиле этого человека"
            value={speaker}
            onChange={(e) => setSpeaker(e.currentTarget.value)}
            disabled={isUploading}
          />
        </Stack>
      </Paper>

      <Paper shadow="xs" p="lg" radius="md" withBorder>
        <Stack gap="md">
          <Text fw={600} size="lg">
            Вставьте текст
          </Text>
          <Textarea
            placeholder="Вставьте текст документа для индексации..."
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            minRows={6}
            maxRows={15}
            autosize
            disabled={isUploading || !!selectedFile}
          />
        </Stack>
      </Paper>

      <Paper shadow="xs" p="lg" radius="md" withBorder>
        <Stack gap="md">
          <Text fw={600} size="lg">
            Или загрузите файл
          </Text>
          <Dropzone
            onDrop={handleDrop}
            onReject={() =>
              dispatch(setError("Неподдерживаемый формат файла"))
            }
            maxSize={10 * 1024 * 1024}
            accept={[MIME_TYPES.pdf, "text/plain"]}
            disabled={isUploading}
            multiple={false}
          >
            <Group
              justify="center"
              gap="xl"
              mih={120}
              style={{ pointerEvents: "none" }}
            >
              <Dropzone.Accept>
                <IconUpload size={40} stroke={1.5} color="var(--mantine-color-blue-6)" />
              </Dropzone.Accept>
              <Dropzone.Reject>
                <IconX size={40} stroke={1.5} color="var(--mantine-color-red-6)" />
              </Dropzone.Reject>
              <Dropzone.Idle>
                <IconFileText size={40} stroke={1.5} color="var(--mantine-color-dimmed)" />
              </Dropzone.Idle>

              <div>
                <Text size="lg" inline>
                  Перетащите файл сюда или нажмите для выбора
                </Text>
                <Text size="sm" c="dimmed" inline mt={7}>
                  Поддерживаются .txt и .pdf, максимум 10 МБ
                </Text>
              </div>
            </Group>
          </Dropzone>

          {selectedFile && (
            <Group>
              <Badge
                size="lg"
                leftSection={
                  selectedFile.name.endsWith(".pdf") ? (
                    <IconFileTypePdf size={14} />
                  ) : (
                    <IconFileText size={14} />
                  )
                }
                variant="light"
                color="blue"
                rightSection={
                  <IconX
                    size={14}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedFile(null)}
                  />
                }
              >
                {selectedFile.name}
              </Badge>
            </Group>
          )}
        </Stack>
      </Paper>

      {isUploading && (
        <Paper shadow="xs" p="lg" radius="md" withBorder>
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {progressLabel}
            </Text>
            <Progress
              value={progress}
              size="lg"
              radius="xl"
              animated={progress < 100}
              color={progress === 100 ? "green" : "blue"}
            />
          </Stack>
        </Paper>
      )}

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          title="Ошибка"
          color="red"
          withCloseButton
          onClose={() => dispatch(setError(null))}
        >
          {error}
        </Alert>
      )}

      <Button
        size="lg"
        onClick={handleSubmitText}
        loading={isUploading}
        disabled={!text.trim() && !selectedFile}
        leftSection={
          progress === 100 ? <IconCheck size={20} /> : <IconUpload size={20} />
        }
        color={progress === 100 ? "green" : "blue"}
      >
        {isUploading
          ? "Обработка..."
          : progress === 100
            ? "Загружено!"
            : "Загрузить и проиндексировать"}
      </Button>
    </Stack>
  );
}
