-- Опорные блоки под продающий контент: возражения, выгоды, причины, воронка.
ALTER TABLE "ContentPlan" ADD COLUMN "objections" JSONB;
ALTER TABLE "ContentPlan" ADD COLUMN "benefits" JSONB;
ALTER TABLE "ContentPlan" ADD COLUMN "reasons" JSONB;
ALTER TABLE "ContentPlan" ADD COLUMN "funnelSteps" JSONB;
