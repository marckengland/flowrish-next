-- CreateTable
CREATE TABLE "WebsiteReceptionistConfig" (
    "organizationId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dailyMessageLimit" INTEGER NOT NULL DEFAULT 5,
    "dailyTokenLimit" INTEGER NOT NULL DEFAULT 20000,
    "dailyCallbackLimit" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteReceptionistConfig_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "WebsiteReceptionistUsage" (
    "organizationId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "scope" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "callbacks" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteReceptionistUsage_pkey" PRIMARY KEY ("organizationId","day","scope")
);

-- CreateTable
CREATE TABLE "WebsiteReceptionistSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "siteOrigin" TEXT NOT NULL,
    "configVersion" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "inFlightId" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastRequestId" TEXT,
    "lastResponse" JSONB,
    "callbackSubmittedAt" TIMESTAMP(3),

    CONSTRAINT "WebsiteReceptionistSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteReceptionistCallback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "siteOrigin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "reviewedById" TEXT,

    CONSTRAINT "WebsiteReceptionistCallback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteReceptionistConfig_publicId_key" ON "WebsiteReceptionistConfig"("publicId");

-- CreateIndex
CREATE INDEX "WebsiteReceptionistUsage_day_idx" ON "WebsiteReceptionistUsage"("day");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteReceptionistSession_tokenHash_key" ON "WebsiteReceptionistSession"("tokenHash");

-- CreateIndex
CREATE INDEX "WebsiteReceptionistSession_organizationId_idx" ON "WebsiteReceptionistSession"("organizationId");

-- CreateIndex
CREATE INDEX "WebsiteReceptionistSession_expiresAt_idx" ON "WebsiteReceptionistSession"("expiresAt");

-- CreateIndex
CREATE INDEX "WebsiteReceptionistCallback_organizationId_status_createdAt_idx" ON "WebsiteReceptionistCallback"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebsiteReceptionistCallback_organizationId_sourceSessionId_key" ON "WebsiteReceptionistCallback"("organizationId", "sourceSessionId");

-- AddForeignKey
ALTER TABLE "WebsiteReceptionistConfig" ADD CONSTRAINT "WebsiteReceptionistConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteReceptionistUsage" ADD CONSTRAINT "WebsiteReceptionistUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteReceptionistSession" ADD CONSTRAINT "WebsiteReceptionistSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteReceptionistCallback" ADD CONSTRAINT "WebsiteReceptionistCallback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Website visitor state is server-only; no Data API role may read or write it.
ALTER TABLE "WebsiteReceptionistConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebsiteReceptionistUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebsiteReceptionistSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebsiteReceptionistCallback" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "WebsiteReceptionistConfig", "WebsiteReceptionistUsage", "WebsiteReceptionistSession", "WebsiteReceptionistCallback" FROM PUBLIC, anon, authenticated;

ALTER TABLE "WebsiteReceptionistUsage" ADD CONSTRAINT "WebsiteReceptionistUsage_nonnegative" CHECK (sessions >= 0 AND messages >= 0 AND "reservedTokens" >= 0 AND callbacks >= 0);
ALTER TABLE "WebsiteReceptionistSession" ADD CONSTRAINT "WebsiteReceptionistSession_turns" CHECK (turns >= 0 AND turns <= 6);
ALTER TABLE "WebsiteReceptionistCallback" ADD CONSTRAINT "WebsiteReceptionistCallback_status" CHECK (status IN ('pending', 'reviewed', 'dismissed'));
