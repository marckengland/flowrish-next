import 'server-only'
import { Prisma } from '@prisma/client'

// Current saved flags only. Grouping does not infer semantic similarity or answers.
export function knowledgeGapCte(organizationId: string): Prisma.Sql {
  return Prisma.sql`WITH flagged AS (
    SELECT r."id" AS "rehearsalId", r."title", r."createdAt", r."updatedAt",
      (m.ordinality - 1)::int AS "messageIndex", m.value->>'content' AS question,
      lower(btrim(regexp_replace(m.value->>'content', '[[:space:]]+', ' ', 'g'))) AS normalized
    FROM "ReceptionistRehearsal" r
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r."snapshot"->'messages')='array' THEN r."snapshot"->'messages' ELSE '[]'::jsonb END) WITH ORDINALITY m(value, ordinality)
    WHERE r."organizationId"=${organizationId} AND cardinality(r."unansweredMessageIndexes") > 0 AND m.ordinality <= 29
      AND (m.ordinality - 1)::int = ANY(r."unansweredMessageIndexes")
      AND m.value->>'role'='caller' AND jsonb_typeof(m.value->'content')='string'
      AND length(btrim(regexp_replace(m.value->>'content', '[[:space:]]+', ' ', 'g'))) BETWEEN 1 AND 4096
  ), occurrences AS (
    SELECT f.*, encode(sha256(convert_to(f.normalized, 'UTF8')), 'hex') AS key,
      d."id" AS "documentId", d."title" AS "documentTitle",
      CASE WHEN d."id" IS NULL THEN NULL WHEN d."archivedAt" IS NOT NULL THEN 'archived'
        WHEN d."publishedAt" IS NULL OR d."publishedRevision" IS NULL THEN 'draft'
        WHEN d."receptionistApprovedRevision"=d."publishedRevision" THEN 'approved' ELSE 'published' END AS "faqStatus",
      encode(sha256(convert_to(jsonb_build_array(f."rehearsalId", f."messageIndex", extract(epoch FROM f."updatedAt"), d."id", extract(epoch FROM d."updatedAt"))::text, 'UTF8')), 'hex') AS "sourceVersion"
    FROM flagged f
    LEFT JOIN "RehearsalFaqDraft" l ON l."organizationId"=${organizationId} AND l."rehearsalId"=f."rehearsalId" AND l."messageIndex"=f."messageIndex"
    LEFT JOIN "KnowledgeDocument" d ON d."id"=l."documentId" AND d."organizationId"=${organizationId}
  ), groups AS (
    SELECT key, min(question) AS question, count(*)::int AS "occurrenceCount", max("updatedAt") AS "latestAt",
      (count(*) FILTER (WHERE "faqStatus"='draft'))::int AS draft,
      (count(*) FILTER (WHERE "faqStatus"='published'))::int AS published,
      (count(*) FILTER (WHERE "faqStatus"='approved'))::int AS approved,
      (count(*) FILTER (WHERE "faqStatus"='archived'))::int AS archived,
      encode(sha256(convert_to(string_agg("sourceVersion", ',' ORDER BY "rehearsalId", "messageIndex"), 'UTF8')), 'hex') AS "sourceFingerprint"
    FROM occurrences GROUP BY key
  ), inbox AS (
    SELECT g.*, encode(sha256(convert_to(jsonb_build_array(g."sourceFingerprint", extract(epoch FROM review."updatedAt"))::text, 'UTF8')), 'hex') AS version,
      CASE WHEN review."resolvedAt" IS NOT NULL AND review."resolvedFingerprint"=g."sourceFingerprint" THEN 'resolved' ELSE 'open' END AS status,
      (review."resolvedAt" IS NOT NULL AND review."resolvedFingerprint" IS DISTINCT FROM g."sourceFingerprint") AS "changedSinceResolution",
      review."notes" AS "reviewNotes", review."resolvedAt", review."updatedAt" AS "reviewUpdatedAt"
    FROM groups g LEFT JOIN "KnowledgeGapReview" review ON review."organizationId"=${organizationId} AND review."questionKey"=g.key
  )`
}
