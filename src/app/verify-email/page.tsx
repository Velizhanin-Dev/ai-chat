"use client";

import { useRouter } from "next/navigation";
import { Stack, Button, Text, ThemeIcon, Anchor } from "@mantine/core";
import { IconMailFilled } from "@tabler/icons-react";
import AuthLayout from "@/components/Auth/AuthLayout";
import { useAppDispatch } from "@/store/hooks";
import { authenticated, mockUserFromEmail } from "@/store/authSlice";

export default function VerifyEmailPage() {
  const router = useRouter();
  const dispatch = useAppDispatch();

  // Лёгкий мок: «подтверждение» сразу пускает в приложение.
  const verified = () => {
    dispatch(authenticated(mockUserFromEmail("user@example.com")));
    router.push("/chat");
  };

  return (
    <AuthLayout
      title="Подтвердите почту"
      subtitle="Мы отправили письмо со ссылкой подтверждения на указанный адрес. Откройте его, чтобы активировать аккаунт."
    >
      <Stack gap="lg" align="center" ta="center">
        <ThemeIcon size={64} radius="xl" variant="light" color="brand">
          <IconMailFilled size={30} />
        </ThemeIcon>

        <Text c="dimmed" size="sm">
          Письмо не пришло? Проверьте «Спам» или отправьте подтверждение заново.
        </Text>

        {/* Заглушка: кнопка имитирует переход по ссылке из письма */}
        <Button radius="xl" size="md" color="brand" onClick={verified} fullWidth>
          Я подтвердил — продолжить
        </Button>

        <Anchor size="sm" c="brand" onClick={(e) => e.preventDefault()} href="#">
          Отправить письмо ещё раз
        </Anchor>
      </Stack>
    </AuthLayout>
  );
}
