import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isAdmin } from "@/lib/admin";
import { apiError } from "@/lib/http";
import { readUpload } from "@/lib/uploads";
import { parseStoredAttachments } from "@/lib/support";

export const dynamic = "force-dynamic";

// Отдача картинки, приложенной к сообщению поддержки.
//
// ⚠️ Именно роутом, а не статикой из public: в переписке поддержки люди присылают
// личные кабинеты, счета и паспорта. Публичный угадываемый адрес тут недопустим,
// поэтому на каждый запрос сверяем, чей это тред.
//
// Доступ: владелец треда ИЛИ админ (он отвечает на обращения и должен видеть
// скриншот, иначе смысл вложений теряется).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; index: string }> }
) {
  const user = await getSessionUser();
  if (!user) return apiError("Не авторизованы", 401);

  const { id, index } = await params;
  const msg = await prisma.supportMessage.findUnique({
    where: { id },
    select: { userId: true, attachments: true },
  });
  // ⚠️ Один и тот же ответ на «нет такого сообщения» и «чужое сообщение»: иначе
  // по коду ответа можно перебором узнать, какие id существуют.
  if (!msg || (msg.userId !== user.id && !isAdmin(user))) return apiError("Not found", 404);

  const files = parseStoredAttachments(msg.attachments);
  const i = Number(index);
  const file = Number.isInteger(i) && i >= 0 ? files[i] : undefined;
  if (!file) return apiError("Not found", 404);

  try {
    const data = await readUpload(file.path);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mime,
        // private: картинка личная, кэшировать её общим кэшем нельзя. immutable —
        // содержимое по этому адресу уже не поменяется.
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    // Файл мог быть вычищен руками с диска — строка в БД при этом осталась.
    return apiError("Not found", 404);
  }
}
