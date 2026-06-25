-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "priceRub" INTEGER NOT NULL,
    "period" TEXT NOT NULL,
    "features" TEXT[],
    "limits" JSONB NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
