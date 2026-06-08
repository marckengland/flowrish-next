import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

/**
 * One-off script that ensures the Supabase Storage bucket used by file
 * attachments exists. Run with:
 *
 *   npx tsx scripts/setup-supabase-storage.ts
 *
 * Idempotent — re-runs are safe. Uses the service-role key so it
 * bypasses RLS and can create buckets on a fresh project.
 */

const BUCKET = 'attachments'

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SECRET_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!serviceKey) throw new Error('SUPABASE_SECRET_KEY is not set')

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: existing, error: listError } = await supabase.storage.listBuckets()
  if (listError) {
    throw new Error(`Failed to list buckets: ${listError.message}`)
  }

  if (existing?.some((b) => b.name === BUCKET)) {
    console.log(`✓ Bucket "${BUCKET}" already exists — nothing to do.`)
    return
  }

  const { error: createError } = await supabase.storage.createBucket(BUCKET, {
    public: false,
    // Cap matches MAX_FILE_SIZE_BYTES in src/server/services/files.ts.
    fileSizeLimit: 25 * 1024 * 1024,
  })
  if (createError) {
    throw new Error(`Failed to create bucket: ${createError.message}`)
  }

  console.log(`✓ Created private bucket "${BUCKET}".`)
  console.log(
    '  Application-level RBAC + tenant scoping enforce isolation; the',
  )
  console.log(
    '  service role bypasses RLS for uploads and signed-URL generation.',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
