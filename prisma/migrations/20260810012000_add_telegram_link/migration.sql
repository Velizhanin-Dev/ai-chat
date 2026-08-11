-- Связь аккаунта с чатом в Telegram (кнопка «Поддержка в Telegram»).
-- Ставится ботом при /start с одноразовым токеном; по ней ответы поддержки
-- уходят человеку в личку тем же ботом, что шлёт уведомления админу.
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");
