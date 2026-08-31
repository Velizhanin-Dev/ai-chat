-- Вложения в сообщениях чата (картинки/PDF для vision-модели).
ALTER TABLE "Message" ADD COLUMN "attachments" JSONB;
