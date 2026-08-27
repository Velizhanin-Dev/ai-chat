-- Профиль проекта: выводы из брифа/канала/источников вместо сырой анкеты.
ALTER TABLE "Conversation" ADD COLUMN "profile" JSONB;
ALTER TABLE "Conversation" ADD COLUMN "profileAt" TIMESTAMP(3);

-- Изученные страницы проекта (их много: клиенты, объекты, лендинги).
CREATE TABLE "ProjectSource" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'site',
    "digest" JSONB,
    "text" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectSource_conversationId_createdAt_idx" ON "ProjectSource"("conversationId", "createdAt");
ALTER TABLE "ProjectSource" ADD CONSTRAINT "ProjectSource_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Кэш страниц: содержимое публичное, поэтому общий на всех проектов.
CREATE TABLE "PageSnapshot" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "headings" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PageSnapshot_url_key" ON "PageSnapshot"("url");
