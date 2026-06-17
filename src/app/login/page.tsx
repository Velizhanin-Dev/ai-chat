"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@mantine/form";
import {
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Group,
  Checkbox,
  Anchor,
  Divider,
  Text,
  Alert,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import AuthLayout from "@/components/Auth/AuthLayout";
import SocialButtons from "@/components/Auth/SocialButtons";
import { useAppDispatch } from "@/store/hooks";
import { authenticated } from "@/store/authSlice";
import { apiLogin } from "@/lib/auth-client";

const APP_HOME = "/chat";

export default function LoginPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "", password: "", remember: true },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Введите корректный email"),
      password: (v) => (v.length >= 6 ? null : "Минимум 6 символов"),
    },
  });

  const submit = async (values: { email: string; password: string }) => {
    setError(null);
    setLoading(true);
    const res = await apiLogin({ email: values.email, password: values.password });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    dispatch(authenticated(res.data.user));
    router.push(APP_HOME);
  };

  return (
    <AuthLayout
      title="С возвращением"
      subtitle="Войдите, чтобы продолжить работу над контентом."
      footer={
        <Text ta="center" size="sm" c="dimmed">
          Нет аккаунта?{" "}
          <Anchor component={Link} href="/register" c="brand" fw={500}>
            Зарегистрироваться
          </Anchor>
        </Text>
      }
    >
      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="md">
          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} p="xs">
              {error}
            </Alert>
          )}
          <TextInput
            label="Email"
            placeholder="you@example.com"
            radius="md"
            size="md"
            key={form.key("email")}
            {...form.getInputProps("email")}
          />
          <PasswordInput
            label="Пароль"
            placeholder="Ваш пароль"
            radius="md"
            size="md"
            key={form.key("password")}
            {...form.getInputProps("password")}
          />
          <Group justify="space-between">
            <Checkbox
              label="Запомнить меня"
              key={form.key("remember")}
              {...form.getInputProps("remember", { type: "checkbox" })}
            />
            <Anchor component={Link} href="/forgot-password" size="sm" c="brand">
              Забыли пароль?
            </Anchor>
          </Group>
          <Button type="submit" radius="xl" size="md" color="brand" fullWidth loading={loading}>
            Войти
          </Button>
        </Stack>
      </form>

      <Divider my="xs" label="или" labelPosition="center" />

      <SocialButtons />
    </AuthLayout>
  );
}
