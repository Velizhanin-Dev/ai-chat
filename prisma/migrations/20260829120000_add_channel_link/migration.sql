-- Канал, привязанный по ссылке (без OAuth): публичная статистика для тех, у кого
-- канал на бренд-аккаунте и пройти OAuth они не могут.
CREATE TABLE "ChannelLink" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thumbnail" TEXT,
    "customUrl" TEXT,
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "hiddenSubs" BOOLEAN NOT NULL DEFAULT false,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChannelLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChannelLink_conversationId_key" ON "ChannelLink"("conversationId");
ALTER TABLE "ChannelLink" ADD CONSTRAINT "ChannelLink_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
