-- CreateTable
CREATE TABLE "Thumbnail" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'speaker',
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "label" TEXT NOT NULL DEFAULT '',
    "refIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "spec" JSONB,
    "prompt" TEXT,
    "model" TEXT NOT NULL DEFAULT '',
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Thumbnail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Thumbnail_conversationId_kind_createdAt_idx" ON "Thumbnail"("conversationId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "Thumbnail" ADD CONSTRAINT "Thumbnail_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thumbnail" ADD CONSTRAINT "Thumbnail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
