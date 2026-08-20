-- Каналы-конкуренты, добавленные руками (пер-проектный список).
CREATE TABLE "TrackedChannel" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "thumbnail" TEXT,
    "customUrl" TEXT,
    "subscribers" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrackedChannel_conversationId_channelId_key" ON "TrackedChannel"("conversationId", "channelId");

ALTER TABLE "TrackedChannel" ADD CONSTRAINT "TrackedChannel_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
