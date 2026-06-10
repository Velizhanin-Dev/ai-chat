"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "@mantine/form";
import {
  TextInput,
  Button,
  Stack,
  Anchor,
  Text,
  ThemeIcon,
  Group,
} from "@mantine/core";
import { IconMailCheck, IconArrowLeft } from "@tabler/icons-react";
import AuthLayout from "@/components/Auth/AuthLayout";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);

  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "" },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Введите корректный email"),
    },
  });

  if (sent) {
    return (
      <AuthLayout
        title="Проверьте почту"
        subtitle={`Если аккаунт с адресом ${sent} существует — мы отправили ссылку для сброса пароля.`}
      >
        <Stack gap="lg" align="center" ta="center">
          <ThemeIcon size={64} radius="xl" variant="light" color="brand">
            <IconMailCheck size={32} />
          </ThemeIcon>
          <Text c="dimmed" size="sm">
            Не пришло за пару минут? Проверьте папку «Спам» или отправьте письмо
            заново.
          </Text>
          <Button variant="default" radius="xl" onClick={() => setSent(null)}>
            Отправить ещё раз
          </Button>
          <Anchor
            component={Link}
            href="/login"
            size="sm"
            c="dimmed"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconArrowLeft size={15} />
            Вернуться ко входу
          </Anchor>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Сброс пароля"
      subtitle="Укажите email — пришлём ссылку для восстановления доступа."
      footer={
        <Group justify="center">
          <Anchor
            component={Link}
            href="/login"
            size="sm"
            c="dimmed"
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <IconArrowLeft size={15} />
            Вернуться ко входу
          </Anchor>
        </Group>
      }
    >
      <form onSubmit={form.onSubmit((v) => setSent(v.email))}>
        <Stack gap="md">
          <TextInput
            label="Email"
            placeholder="you@example.com"
            radius="md"
            size="md"
            key={form.key("email")}
            {...form.getInputProps("email")}
          />
          <Button type="submit" radius="xl" size="md" color="brand" fullWidth>
            Отправить ссылку
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
