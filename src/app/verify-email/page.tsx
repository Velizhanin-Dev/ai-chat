"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Stack, Button, Text, ThemeIcon, Anchor, Loader } from "@mantine/core";
import {
  IconMailFilled,
  IconCircleCheck,
  IconAlertTriangle,
} from "@tabler/icons-react";
import AuthLayout from "@/components/Auth/AuthLayout";
import { apiVerifyEmail, apiResendVerification } from "@/lib/auth-client";

type State = "info" | "verifying" | "success" | "error";

export default function VerifyEmailPage() {
  const router = useRouter();
  // info — пришли после регистрации (письмо отправлено, вход уже работает);
  // остальные — переход по ссылке из письма (?token=…).
  const [state, setState] = useState<State>("info");
  const [resent, setResent] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;
    setState("verifying");
    apiVerifyEmail(token).then((res) => setState(res.ok ? "success" : "error"));
  }, []);

  const resend = async () => {
    await apiResendVerification();
    setResent(true);
  };

  if (state === "verifying") {
    return (
      <AuthLayout title="Подтверждаем почту" subtitle="Секунду…">
        <Stack align="center" py="lg">
          <Loader color="brand" />
        </Stack>
      </AuthLayout>
    );
  }

  if (state === "success") {
    return (
      <AuthLayout
        title="Почта подтверждена"
        subtitle="Готово — аккаунт активирован."
      >
        <Stack gap="lg" align="center" ta="center">
          <ThemeIcon size={64} radius="xl" variant="light" color="brand">
            <IconCircleCheck size={32} />
          </ThemeIcon>
          <Button radius="xl" size="md" color="brand" onClick={() => router.push("/chat")} fullWidth>
            Перейти в чат
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  if (state === "error") {
    return (
      <AuthLayout
        title="Ссылка не сработала"
        subtitle="Возможно, она устарела или уже была использована."
      >
        <Stack gap="lg" align="center" ta="center">
          <ThemeIcon size={64} radius="xl" variant="light" color="red">
            <IconAlertTriangle size={30} />
          </ThemeIcon>
          <Button
            variant="default"
            radius="xl"
            onClick={resend}
            disabled={resent}
          >
            {resent ? "Письмо отправлено" : "Отправить новое письмо"}
          </Button>
          <Anchor size="sm" c="brand" onClick={() => router.push("/chat")}>
            Продолжить без подтверждения
          </Anchor>
        </Stack>
      </AuthLayout>
    );
  }

  // info
  return (
    <AuthLayout
      title="Подтвердите почту"
      subtitle="Мы отправили письмо со ссылкой подтверждения. Войти можно уже сейчас — подтвердить почту получится в любой момент."
    >
      <Stack gap="lg" align="center" ta="center">
        <ThemeIcon size={64} radius="xl" variant="light" color="brand">
          <IconMailFilled size={30} />
        </ThemeIcon>

        <Text c="dimmed" size="sm">
          Письмо не пришло? Проверьте «Спам» или отправьте подтверждение заново.
        </Text>

        <Button radius="xl" size="md" color="brand" onClick={() => router.push("/chat")} fullWidth>
          Перейти в чат
        </Button>

        <Anchor
          size="sm"
          c="brand"
          onClick={resend}
          style={{ pointerEvents: resent ? "none" : undefined, opacity: resent ? 0.6 : 1 }}
        >
          {resent ? "Письмо отправлено" : "Отправить письмо ещё раз"}
        </Anchor>
      </Stack>
    </AuthLayout>
  );
}
