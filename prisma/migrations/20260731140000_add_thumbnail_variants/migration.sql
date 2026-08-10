-- AlterTable
ALTER TABLE "Thumbnail" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Thumbnail" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Thumbnail_conversationId_parentId_idx" ON "Thumbnail"("conversationId", "parentId");
