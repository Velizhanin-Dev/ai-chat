-- Уведомления «у конкурента залетел ролик»: флаг на проекте + журнал отправленных.
ALTER TABLE "Conversation" ADD COLUMN "competitorAlerts" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CompetitorAlert" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompetitorAlert_conversationId_videoId_key" ON "CompetitorAlert"("conversationId", "videoId");

ALTER TABLE "CompetitorAlert" ADD CONSTRAINT "CompetitorAlert_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
