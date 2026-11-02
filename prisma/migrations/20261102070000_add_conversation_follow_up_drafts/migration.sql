-- Draft text and metadata only. Full provider conversation bodies are not stored.
ALTER TABLE "FollowUpSuggestion"
ADD COLUMN "draftGeneratedAt" TIMESTAMP(3),
ADD COLUMN "draftVersion" TEXT,
ADD COLUMN "draftContext" JSONB;
