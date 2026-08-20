-- Сохранённая выдача поиска референсов: повтор того же поиска не тратит квоту
-- даже после перезапуска приложения.
CREATE TABLE "CompetitorSearch" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "tokens" JSONB NOT NULL,
    "seen" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorSearch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompetitorSearch_conversationId_key_key" ON "CompetitorSearch"("conversationId", "key");

ALTER TABLE "CompetitorSearch" ADD CONSTRAINT "CompetitorSearch_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
