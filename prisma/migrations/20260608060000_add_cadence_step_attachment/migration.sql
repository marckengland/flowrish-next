-- CreateTable
CREATE TABLE "CadenceStepAttachment" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadenceStepAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CadenceStepAttachment_organizationId_idx" ON "CadenceStepAttachment"("organizationId");

-- CreateIndex
CREATE INDEX "CadenceStepAttachment_stepId_idx" ON "CadenceStepAttachment"("stepId");

-- AddForeignKey
ALTER TABLE "CadenceStepAttachment" ADD CONSTRAINT "CadenceStepAttachment_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "CadenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceStepAttachment" ADD CONSTRAINT "CadenceStepAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
