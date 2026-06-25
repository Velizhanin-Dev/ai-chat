// Назначить пользователю роль админа: node scripts/make-admin.mjs <email>
// Разовый бутстрап первого админа (дальше роли можно раздавать из самой админки
// в будущей фазе). Альтернатива без скрипта — ADMIN_BOOTSTRAP_EMAILS в .env.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = (process.argv[2] || "").trim();

if (!email) {
  console.error("Использование: node scripts/make-admin.mjs <email>");
  process.exit(1);
}

const user = await prisma.user
  .update({ where: { email }, data: { role: "admin" } })
  .catch(() => null);

console.log(user ? `OK: ${email} теперь admin` : `Не найден пользователь: ${email}`);
await prisma.$disconnect();
process.exit(user ? 0 : 1);
