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
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { authenticated } from "@/store/authSlice";
import { apiLogin } from "@/lib/auth-client";
import { ymGoal } from "@/lib/metrika";

const APP_HOME = "/chat";

// Безопасный внутренний путь возврата из ?next (иначе APP_HOME).
function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : APP_HOME;
}

// Сообщения по кодам ошибок из OAuth-колбэка (?error=...).
const OAUTH_ERRORS: Record<string, string> = {
  oauth_unavailable: "Вход через эту соцсеть пока не подключён.",
  oauth_unknown_provider: "Неизвестный способ входа.",
  oauth_denied: "Вход через соцсеть отменён.",
  oauth_failed: "Не удалось войти через соцсеть. Попробуйте ещё раз.",
  oauth_state_missing: "Сессия входа истекла. Попробуйте ещё раз.",
  oauth_state_bad: "Сессия входа повреждена. Попробуйте ещё раз.",
  oauth_state_mismatch: "Сессия входа не совпала. Попробуйте ещё раз.",
  launch_locked: "Доступ к ассистенту откроется после запуска.",
};

export default function LoginPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const authedOnMount = useAppSelector((s) => s.auth.ready && Boolean(s.auth.user));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Уже авторизован (сессия с сервера засеяна в стор) → нечего делать на /login,
  // уводим внутрь. Только на маунте: чтобы не конфликтовать с навигацией после
  // ручного входа (там submit сам решает, куда вести).
  useEffect(() => {
    if (authedOnMount) router.replace(safeNext());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ошибка после неудачного OAuth-редиректа (?error=...). Читаем на клиенте,
  // чтобы не тащить useSearchParams (требует Suspense на странице).
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code && OAUTH_ERRORS[code]) setError(OAUTH_ERRORS[code]);
  }, []);

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
    ymGoal("login");
    // Возврат на исходный роут, если пришли по редиректу из middleware
    // (/login?next=/chat). Берём только безопасный внутренний путь.
    router.push(safeNext());
  };

  // Авторизованного не держим на форме входа (редирект уже запущен на маунте).
  if (authedOnMount) return null;

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
