-- CreateTable
CREATE TABLE "Stat" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "routeCategory" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,

    CONSTRAINT "Stat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Stat_createdAt_idx" ON "Stat"("createdAt");

-- CreateIndex
CREATE INDEX "Stat_userId_idx" ON "Stat"("userId");

-- CreateIndex
CREATE INDEX "Stat_kind_createdAt_idx" ON "Stat"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "Stat" ADD CONSTRAINT "Stat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
