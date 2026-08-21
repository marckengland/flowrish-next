import 'dotenv/config'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  type AnyThreadChannel,
  type Message,
  type TextChannel,
} from 'discord.js'

/**
 * Discord feedback → dev worklist (Kiro-driven).
 *
 * A developer tool (NOT part of the Flowrish app runtime) for pulling user
 * feedback out of a Discord channel so it can be fixed, and for closing those
 * items out once the fix ships.
 *
 * There is deliberately no AI/LLM call here: the `pull` command just dumps the
 * raw thread text and saves any screenshots to a local folder. Kiro reads that
 * output (including the images) and produces the triage/worklist directly.
 *
 * Workflow:
 *   1. `pull`  — read every open thread (no "done" reaction yet), print its
 *                transcript, and download image attachments to
 *                `.kiro-discord-feedback/<threadId>/`. Also writes a manifest
 *                at `.kiro-discord-feedback/manifest.json`.
 *   2. Kiro reads the transcripts + images and fixes the issues in the repo.
 *   3. `done`  — react to a thread so it drops off the next `pull`.
 *
 * Commands:
 *   npm run discord:feedback                      # pull open feedback (default)
 *   npm run discord:feedback -- pull --json       # manifest JSON to stdout only
 *   npm run discord:feedback -- pull --all        # include already-done threads
 *   npm run discord:feedback -- done <id> [<id>…] # mark thread(s) done
 *
 * Required env:
 *   DISCORD_BOT_TOKEN            bot token from the Developer Portal
 *   DISCORD_FEEDBACK_CHANNEL_ID  the text channel whose threads to triage
 *
 * Optional env:
 *   DISCORD_DONE_EMOJI          reaction used to mark done (default ✅)
 *
 * The bot needs the "Message Content Intent" enabled (Developer Portal →
 * Bot → Privileged Gateway Intents) and, in the server, permission to View
 * Channel, Read Message History, and Add Reactions.
 */

// ─── CLI parsing ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const command = argv.find((a) => !a.startsWith('-')) ?? 'pull'
const JSON_OUTPUT = argv.includes('--json')
const INCLUDE_DONE = argv.includes('--all')
const doneTargets = argv.filter((a) => a !== command && !a.startsWith('-'))

// ─── Config ──────────────────────────────────────────────────────────────────

const BOT_TOKEN = requireEnv('DISCORD_BOT_TOKEN')
const CHANNEL_ID = requireEnv('DISCORD_FEEDBACK_CHANNEL_ID')
const DONE_EMOJI = process.env.DISCORD_DONE_EMOJI?.trim() || '✅'

const OUTPUT_DIR = '.kiro-discord-feedback'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`✗ Missing required env var: ${name}`)
    process.exit(1)
  }
  return value
}

// ─── Thread reading ──────────────────────────────────────────────────────────

const IMAGE_CONTENT_TYPES = /^image\/(png|jpe?g|gif|webp)$/i
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

async function downloadImage(
  url: string,
  destPath: string,
): Promise<boolean> {
  try {
    const res = await fetch(url)
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return false
    await writeFile(destPath, buf)
    return true
  } catch {
    return false
  }
}

interface ThreadData {
  threadId: string
  threadName: string
  url: string
  transcript: string
  images: string[]
}

async function readThread(thread: AnyThreadChannel): Promise<ThreadData> {
  const collected: Message[] = []
  let before: string | undefined

  for (;;) {
    const batch = await thread.messages.fetch({ limit: 100, before })
    if (batch.size === 0) break
    collected.push(...batch.values())
    before = batch.last()?.id
    if (batch.size < 100) break
  }

  collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp)

  const lines: string[] = [`Thread title: ${thread.name}`, '']
  const images: string[] = []
  const threadDir = join(OUTPUT_DIR, thread.id)
  let imgIndex = 0
  let madeDir = false

  for (const msg of collected) {
    const author = msg.author?.bot
      ? `${msg.author.username} (bot)`
      : msg.author?.username ?? 'unknown'
    const ts = new Date(msg.createdTimestamp).toISOString().slice(0, 16).replace('T', ' ')
    lines.push(`[${ts}] ${author}: ${msg.content?.trim() || '(no text)'}`)

    for (const attachment of msg.attachments.values()) {
      const ct = (attachment.contentType ?? '').split(';')[0]
      if (IMAGE_CONTENT_TYPES.test(ct)) {
        if (!madeDir) {
          await mkdir(threadDir, { recursive: true })
          madeDir = true
        }
        const ext = EXT_BY_MIME[ct] ?? 'png'
        const dest = join(threadDir, `${imgIndex++}.${ext}`)
        const ok = await downloadImage(attachment.url, dest)
        if (ok) {
          images.push(dest)
          lines.push(`  [image saved: ${dest}]`)
        } else {
          lines.push(`  [image (download failed): ${attachment.url}]`)
        }
      } else if (attachment.name) {
        lines.push(`  [attachment: ${attachment.name} — ${attachment.url}]`)
      }
    }
  }

  return {
    threadId: thread.id,
    threadName: thread.name,
    url: thread.url,
    transcript: lines.join('\n'),
    images,
  }
}

async function reactionUserIds(
  thread: AnyThreadChannel,
): Promise<Set<string>> {
  const starter = await thread.fetchStarterMessage().catch(() => null)
  if (!starter) return new Set()
  const reaction = starter.reactions.cache.find((r) => r.emoji.name === DONE_EMOJI)
  if (!reaction) return new Set()
  const users = await reaction.users.fetch()
  return new Set(users.keys())
}

async function collectThreads(channel: TextChannel): Promise<AnyThreadChannel[]> {
  const threads = new Map<string, AnyThreadChannel>()

  const active = await channel.threads.fetchActive()
  for (const t of active.threads.values()) threads.set(t.id, t)

  const archivedPublic = await channel.threads.fetchArchived({ type: 'public', limit: 100 })
  for (const t of archivedPublic.threads.values()) threads.set(t.id, t)

  try {
    const archivedPrivate = await channel.threads.fetchArchived({ type: 'private', limit: 100 })
    for (const t of archivedPrivate.threads.values()) threads.set(t.id, t)
  } catch {
    // No permission for private archived threads — skip.
  }

  return [...threads.values()]
}

// ─── Discord client ──────────────────────────────────────────────────────────

async function connect(): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
    ],
  })
  await client.login(BOT_TOKEN)
  await new Promise<void>((resolve) => client.once('clientReady', () => resolve()))
  return client
}

async function getChannel(client: Client): Promise<TextChannel> {
  const channel = await client.channels.fetch(CHANNEL_ID)
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(
      `Channel ${CHANNEL_ID} is not a text channel (got ${channel?.type ?? 'null'})`,
    )
  }
  return channel as TextChannel
}

// ─── Command: pull ───────────────────────────────────────────────────────────

async function runPull(client: Client): Promise<void> {
  const channel = await getChannel(client)
  const botUserId = client.user!.id
  const threads = await collectThreads(channel)

  // Fresh output dir each pull so stale images don't linger.
  await rm(OUTPUT_DIR, { recursive: true, force: true })
  await mkdir(OUTPUT_DIR, { recursive: true })

  const data: ThreadData[] = []
  let skippedDone = 0

  for (const thread of threads) {
    const wasArchived = thread.archived ?? false
    try {
      const doneUserIds = await reactionUserIds(thread)
      if (!INCLUDE_DONE && doneUserIds.has(botUserId)) {
        skippedDone++
        continue
      }
      data.push(await readThread(thread))
    } catch (err) {
      if (!JSON_OUTPUT) {
        console.error(`✗ "${thread.name}" — error: ${(err as Error).message}`)
      }
    } finally {
      if (wasArchived && thread.archived === false) {
        await thread.setArchived(true).catch(() => {})
      }
    }
  }

  await writeFile(
    join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify({ channel: channel.name, pulledAt: new Date().toISOString(), threads: data }, null, 2),
  )

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  if (data.length === 0) {
    console.log('No open feedback. 🎉')
    if (skippedDone) console.log(`(${skippedDone} already marked done)`)
    return
  }

  console.log(
    `\n${data.length} open feedback thread(s)` +
      (skippedDone ? ` · ${skippedDone} already done` : '') +
      `  —  #${channel.name}`,
  )
  console.log(`Manifest + images saved under ${OUTPUT_DIR}/\n`)

  for (const t of data) {
    console.log('─'.repeat(72))
    console.log(`thread ${t.threadId} · ${t.url}`)
    console.log(t.transcript)
    if (t.images.length) {
      console.log(`\nimages (${t.images.length}): ${t.images.join(', ')}`)
    }
    console.log('')
  }

  console.log('─'.repeat(72))
  console.log('Mark one done after fixing:')
  console.log('  npm run discord:feedback -- done <threadId>')
}

// ─── Command: done ───────────────────────────────────────────────────────────

async function runDone(client: Client): Promise<void> {
  if (doneTargets.length === 0) {
    console.error('Usage: npm run discord:feedback -- done <threadId> [<threadId>…]')
    process.exitCode = 1
    return
  }

  for (const id of doneTargets) {
    try {
      const thread = await client.channels.fetch(id)
      if (!thread || !thread.isThread()) {
        console.error(`✗ ${id} is not a thread`)
        continue
      }
      const t = thread as AnyThreadChannel
      const wasArchived = t.archived ?? false
      if (wasArchived) await t.setArchived(false).catch(() => {})

      const starter = await t.fetchStarterMessage().catch(() => null)
      const target = starter ?? (await t.messages.fetch({ limit: 1 })).first()
      if (!target) {
        console.error(`✗ ${id} — no message to react to`)
        continue
      }
      await target.react(DONE_EMOJI)
      console.log(`✓ marked done: "${t.name}" (${id})`)

      if (wasArchived) await t.setArchived(true).catch(() => {})
    } catch (err) {
      console.error(`✗ ${id} — ${(err as Error).message}`)
    }
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const client = await connect()
  console.log(`✓ Logged in as ${client.user!.tag}`)

  try {
    if (command === 'done') {
      await runDone(client)
    } else if (command === 'pull') {
      await runPull(client)
    } else {
      console.error(`Unknown command "${command}". Use "pull" or "done".`)
      process.exitCode = 1
    }
  } finally {
    await client.destroy()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
