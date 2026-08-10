// Выгрузка почт пользователей для рассылки — список в столбик.
//
// Зачем скриптом, а не экраном в админке: список нужен разово, отдаётся человеку,
// который ведёт рассылку в Unisender. Городить под это интерфейс смысла нет.
//
// Запуск (из корня проекта):
//   node scripts/export-emails.mjs                  → в консоль, все почты
//   node scripts/export-emails.mjs --out emails.txt → в файл
//   node scripts/export-emails.mjs --paid           → только платившие
//   node scripts/export-emails.mjs --trial          → только те, кто ни разу не платил
//   node scripts/export-emails.mjs --csv            → email,имя,тариф,регистрация
//
// ⚠️ Почты — персональные данные. Файл не коммитим (см. .gitignore) и передаём
// только тому, кто отвечает за рассылку. В политике (152-ФЗ) рассылка заявлена,
// но отписка — обязанность отправителя: в Unisender список должен быть с
// возможностью отписаться (у нас для этого и заведён UNISENDER_LIST_ID).

import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const prisma = new PrismaClient();

async function main() {
  const onlyPaid = has("--paid");
  const onlyTrial = has("--trial");
  if (onlyPaid && onlyTrial) {
    console.error("--paid и --trial вместе не имеют смысла: выбери что-то одно");
    process.exit(1);
  }

  const users = await prisma.user.findMany({
    select: {
      email: true,
      name: true,
      plan: true,
      createdAt: true,
      // Считаем ТОЛЬКО подтверждённые платежи: строка со статусом NEW висит и у
      // тех, кто открыл оплату и передумал — они не «платившие».
      payments: { where: { status: "CONFIRMED" }, select: { id: true }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows = users
    .filter((u) => u.email && u.email.includes("@"))
    .filter((u) => {
      const paid = u.payments.length > 0;
      if (onlyPaid) return paid;
      if (onlyTrial) return !paid;
      return true;
    });

  const out = has("--csv")
    ? [
        "email,имя,тариф,регистрация",
        ...rows.map((u) =>
          [
            u.email,
            (u.name ?? "").replace(/[",\n]/g, " ").trim(),
            u.plan,
            u.createdAt.toISOString().slice(0, 10),
          ].join(",")
        ),
      ].join("\n")
    : rows.map((u) => u.email).join("\n");

  const file = valueOf("--out");
  if (file) {
    writeFileSync(file, out + "\n", "utf8");
    console.error(`Записано ${rows.length} адресов в ${file}`);
  } else {
    console.log(out);
    console.error(`\n— всего ${rows.length} адресов`);
  }
}

main()
  .catch((err) => {
    console.error("Не удалось выгрузить почты:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
