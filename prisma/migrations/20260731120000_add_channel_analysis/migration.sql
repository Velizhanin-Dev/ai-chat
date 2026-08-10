-- CreateTable
CREATE TABLE "ChannelAnalysis" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'all',
    "periodDays" INTEGER NOT NULL DEFAULT 28,
    "metrics" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "overallScore" INTEGER NOT NULL DEFAULT 0,
    "manualCtr" DOUBLE PRECISION,
    "model" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelAnalysis_conversationId_createdAt_idx" ON "ChannelAnalysis"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChannelAnalysis" ADD CONSTRAINT "ChannelAnalysis_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelAnalysis" ADD CONSTRAINT "ChannelAnalysis_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
