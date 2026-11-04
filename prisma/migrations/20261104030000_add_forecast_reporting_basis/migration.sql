-- No defaults or backfill: historical reports must keep an unknown basis.
ALTER TABLE "ForecastSubmission"
ADD COLUMN "currency" TEXT,
ADD COLUMN "reportingTimezone" TEXT,
ADD COLUMN "calculationVersion" TEXT,
ADD COLUMN "scope" TEXT;

ALTER TABLE "ForecastSnapshot"
ADD COLUMN "currency" TEXT,
ADD COLUMN "reportingTimezone" TEXT,
ADD COLUMN "calculationVersion" TEXT,
ADD COLUMN "scope" TEXT;
