"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@mantine/form";
import {
  TextInput,
  PasswordInput,
  Button,
  Stack,
  Checkbox,
  Anchor,
  Divider,
  Text,
  Alert,
} from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import AuthLayout from "@/components/Auth/AuthLayout";
import SocialButtons from "@/components/Auth/SocialButtons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { authenticated } from "@/store/authSlice";
import { apiRegister } from "@/lib/auth-client";
import { ymGoal } from "@/lib/metrika";
import { utmGoalParams } from "@/lib/utm";
import { readFirstTouch } from "@/lib/utm-client";

export default function RegisterPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const authedOnMount = useAppSelector((s) => s.auth.ready && Boolean(s.auth.user));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Уже авторизован → уводим внутрь (только на маунте).
  useEffect(() => {
    if (authedOnMount) router.replace("/app");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      name: "",
      email: "",
      password: "",
      confirm: "",
      consent: false,
    },
    validate: {
      name: (v) => (v.trim().length >= 2 ? null : "Как вас зовут?"),
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : "Введите корректный email"),
      password: (v) => (v.length >= 8 ? null : "Минимум 8 символов"),
      confirm: (v, values) =>
        v === values.password ? null : "Пароли не совпадают",
      consent: (v) => (v ? null : "Нужно согласие, чтобы продолжить"),
    },
  });

  const submit = async (values: typeof form.values) => {
    setError(null);
    setLoading(true);
    const res = await apiRegister({
      name: values.name.trim(),
      email: values.email,
      password: values.password,
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Регистрация сразу логинит и ведёт в приложение (экран выбора/создания
    // проекта); подтверждение почты убрали.
    dispatch(authenticated(res.data.user));
    ymGoal("signup", utmGoalParams(readFirstTouch()));
    router.push("/app");
  };

  // Авторизованного не держим на форме регистрации (редирект запущен на маунте).
  if (authedOnMount) return null;

  return (
    <AuthLayout
      title="Создать аккаунт"
      subtitle="Пара минут — и можно собирать первый сценарий."
      footer={
        <Text ta="center" size="sm" c="dimmed">
          Уже есть аккаунт?{" "}
          <Anchor component={Link} href="/login" c="brand" fw={500}>
            Войти
          </Anchor>
        </Text>
      }
    >
      <SocialButtons />

      <Divider my="xs" label="или по email" labelPosition="center" />

      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="md">
          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />} p="xs">
              {error}
            </Alert>
          )}
          <TextInput
            label="Имя"
            placeholder="Как к вам обращаться"
            radius="md"
            size="md"
            key={form.key("name")}
            {...form.getInputProps("name")}
          />
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

          <Checkbox
            radius="sm"
            key={form.key("consent")}
            {...form.getInputProps("consent", { type: "checkbox" })}
            label={
              <Text size="sm">
                Принимаю{" "}
                <Anchor
                  component={Link}
                  href="/legal/terms"
                  target="_blank"
                  c="brand"
                  onClick={(e) => e.stopPropagation()}
                >
                  Пользовательское соглашение
                </Anchor>{" "}
                и даю согласие на обработку персональных данных в соответствии с{" "}
                <Anchor
                  component={Link}
                  href="/legal/privacy"
                  target="_blank"
                  c="brand"
                  onClick={(e) => e.stopPropagation()}
                >
                  Политикой конфиденциальности
                </Anchor>
              </Text>
            }
          />

          <Button type="submit" radius="xl" size="md" color="brand" fullWidth loading={loading}>
            Создать аккаунт
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
