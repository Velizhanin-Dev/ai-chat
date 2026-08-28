-- Вложения в чате поддержки: пути к файлам на диске (сами файлы в UPLOAD_DIR).
ALTER TABLE "SupportMessage" ADD COLUMN "attachments" JSONB;
