"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@mantine/form";
import {
  PasswordInput,
  Button,
  Stack,
  Anchor,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { IconCircleCheck } from "@tabler/icons-react";
import AuthLayout from "@/components/Auth/AuthLayout";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [done, setDone] = useState(false);

  const form = useForm({
    mode: "uncontrolled",
    initialValues: { password: "", confirm: "" },
    validate: {
      password: (v) => (v.length >= 8 ? null : "Минимум 8 символов"),
      confirm: (v, values) =>
        v === values.password ? null : "Пароли не совпадают",
    },
  });

  if (done) {
    return (
      <AuthLayout
        title="Пароль обновлён"
        subtitle="Теперь можно войти с новым паролем."
      >
        <Stack gap="lg" align="center" ta="center">
          <ThemeIcon size={64} radius="xl" variant="light" color="brand">
            <IconCircleCheck size={32} />
          </ThemeIcon>
          <Button
            radius="xl"
            size="md"
            color="brand"
            onClick={() => router.push("/login")}
          >
            Перейти ко входу
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Новый пароль"
      subtitle="Придумайте надёжный пароль для входа."
      footer={
        <Text ta="center" size="sm" c="dimmed">
          Вспомнили пароль?{" "}
          <Anchor component={Link} href="/login" c="brand" fw={500}>
            Войти
          </Anchor>
        </Text>
      }
    >
      <form onSubmit={form.onSubmit(() => setDone(true))}>
        <Stack gap="md">
          <PasswordInput
            label="Новый пароль"
            placeholder="Минимум 8 символов"
            radius="md"
            size="md"
            key={form.key("password")}
            {...form.getInputProps("password")}
          />
          <PasswordInput
            label="Повторите пароль"
            placeholder="Ещё раз"
            radius="md"
            size="md"
            key={form.key("confirm")}
            {...form.getInputProps("confirm")}
          />
          <Button type="submit" radius="xl" size="md" color="brand" fullWidth>
            Сохранить пароль
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
