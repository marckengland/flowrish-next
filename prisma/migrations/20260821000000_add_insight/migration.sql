-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'research',
    "summary" TEXT,
    "data" JSONB NOT NULL,
    "sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL DEFAULT 'ai',
    "createdById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Insight_organizationId_idx" ON "Insight"("organizationId");

-- CreateIndex
CREATE INDEX "Insight_organizationId_entityType_entityId_idx" ON "Insight"("organizationId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
