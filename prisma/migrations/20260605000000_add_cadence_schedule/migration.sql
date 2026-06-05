-- CreateTable
CREATE TABLE "CadenceSchedule" (
    "id" TEXT NOT NULL,
    "cadenceId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Default schedule',
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "startTimeMinutes" INTEGER NOT NULL DEFAULT 540,
    "endTimeMinutes" INTEGER NOT NULL DEFAULT 1020,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CadenceSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CadenceSchedule_cadenceId_key" ON "CadenceSchedule"("cadenceId");

-- CreateIndex
CREATE INDEX "CadenceSchedule_organizationId_idx" ON "CadenceSchedule"("organizationId");

-- AddForeignKey
ALTER TABLE "CadenceSchedule" ADD CONSTRAINT "CadenceSchedule_cadenceId_fkey" FOREIGN KEY ("cadenceId") REFERENCES "Cadence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceSchedule" ADD CONSTRAINT "CadenceSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
