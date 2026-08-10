-- CreateTable
CREATE TABLE "ContentPlan" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "niche" TEXT,
    "audience" JSONB,
    "huntLadder" JSONB,
    "funnel" JSONB,
    "model" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPlanVideo" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT 'video',
    "status" TEXT NOT NULL DEFAULT 'idea',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "titles" TEXT[],
    "previewTexts" TEXT[],
    "format" TEXT,
    "noSpeaker" BOOLEAN NOT NULL DEFAULT false,
    "huntStage" TEXT,
    "pain" TEXT,
    "questions" TEXT[],
    "nativeClose" TEXT,
    "cta" JSONB,
    "visp" JSONB,
    "reference" TEXT,
    "whyWorks" TEXT,
    "opening" TEXT,
    "youtubeVideoId" TEXT,
    "thumbnail" TEXT,
    "views" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPlanVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentPlan_conversationId_period_idx" ON "ContentPlan"("conversationId", "period");

-- CreateIndex
CREATE INDEX "ContentPlanVideo_planId_order_idx" ON "ContentPlanVideo"("planId", "order");

-- AddForeignKey
ALTER TABLE "ContentPlan" ADD CONSTRAINT "ContentPlan_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentPlanVideo" ADD CONSTRAINT "ContentPlanVideo_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
