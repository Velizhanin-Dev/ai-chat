"use client";

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
} from "@mantine/core";
import AuthLayout from "@/components/Auth/AuthLayout";
import SocialButtons from "@/components/Auth/SocialButtons";

export default function RegisterPage() {
  const router = useRouter();

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

  // Лёгкий мок: «регистрация» уводит на экран подтверждения почты.
  const submit = () => router.push("/verify-email");

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
      <SocialButtons onProvider={submit} />

      <Divider my="xs" label="или по email" labelPosition="center" />

      <form onSubmit={form.onSubmit(submit)}>
        <Stack gap="md">
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

          {/* TODO(Э2): обернуть названия документов в ссылки на /legal/* */}
          <Checkbox
            radius="sm"
            key={form.key("consent")}
            {...form.getInputProps("consent", { type: "checkbox" })}
            label={
              <Text size="sm">
                Принимаю условия оферты, политику конфиденциальности и даю
                согласие на обработку персональных данных
              </Text>
            }
          />

          <Button type="submit" radius="xl" size="md" color="brand" fullWidth>
            Создать аккаунт
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}
