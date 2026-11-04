import { beforeEach, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => {
  const db = {
    waitlist: { findUnique: vi.fn() },
    waitlistPilotInvite: { findUnique: vi.fn() },
    organizationMember: { findUnique: vi.fn() },
    receptionistConfig: { findUnique: vi.fn() },
    websiteReceptionistConfig: { findUnique: vi.fn() },
    aiProviderConfig: { findUnique: vi.fn() },
    knowledgeDocument: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      fields: { publishedRevision: 'publishedRevision' },
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { db, staff: vi.fn(), ready: vi.fn() }
})
vi.mock('@/server/db/client', () => ({ prisma: mocks.db }))
vi.mock('@/server/auth/waitlist-staff', () => ({
  assertWaitlistStaff: mocks.staff,
}))
vi.mock('../website-receptionist', () => ({ readiness: mocks.ready }))
import { getPilotProgress } from '../pilot-progress'
const source = '11111111-1111-4111-8111-111111111111',
  staffOrg = '22222222-2222-4222-8222-222222222222',
  actor = '33333333-3333-4333-8333-333333333333',
  target = '44444444-4444-4444-8444-444444444444'
const saved = new Date('2026-11-04T01:00:00Z'),
  run = new Date('2026-11-04T02:00:00Z')
beforeEach(() => {
  vi.resetAllMocks()
  mocks.db.$transaction.mockImplementation(async (work) => work(mocks.db))
  mocks.db.waitlist.findUnique.mockResolvedValue({ id: source })
  mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
    acceptedAt: saved,
    acceptedById: 'owner',
    organizationId: target,
    revokedAt: null,
    expiresAt: new Date('2099-11-11'),
  })
  mocks.db.organizationMember.findUnique.mockResolvedValue({ id: 'membership' })
  mocks.db.receptionistConfig.findUnique.mockResolvedValue({ updatedAt: saved })
  mocks.db.websiteReceptionistConfig.findUnique.mockResolvedValue({
    updatedAt: saved,
    enabled: false,
    allowedOrigins: ['https://sample.example'],
  })
  mocks.db.aiProviderConfig.findUnique.mockResolvedValue({ updatedAt: saved })
  mocks.ready.mockResolvedValue({
    hasSavedBusiness: true,
    hasOrganizationAi: true,
    approvedDocuments: 3,
  })
  mocks.db.knowledgeDocument.findMany.mockResolvedValue(
    ['SERVICES', 'PRICING', 'FAQ'].map((publishedCategory) => ({
      publishedCategory,
      updatedAt: saved,
    })),
  )
  mocks.db.knowledgeDocument.aggregate.mockResolvedValue({
    _max: { updatedAt: saved },
  })
  mocks.db.$queryRaw.mockResolvedValue([
    {
      verdict: 'passed',
      createdAt: run,
      updatedAt: run,
      settingsVersion: saved.toISOString(),
      finished: 'true',
    },
  ])
})
const read = () => getPilotProgress(staffOrg, actor, source)
it('denies ungranted staff before any signup or customer lookup', async () => {
  mocks.staff.mockRejectedValue(
    new AppError('FORBIDDEN', 'Flowrish staff access is required.', 403),
  )
  await expect(read()).rejects.toMatchObject({ statusCode: 403 })
  expect(mocks.db.waitlist.findUnique).not.toHaveBeenCalled()
  expect(mocks.ready).not.toHaveBeenCalled()
})
it('only resolves an accepted receipt with retained owner membership', async () => {
  mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue(null)
  expect(await read()).toMatchObject({
    state: 'not_joined',
    invitation: 'not_issued',
  })
  expect(mocks.ready).not.toHaveBeenCalled()
  mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
    acceptedAt: saved,
    acceptedById: 'owner',
    organizationId: target,
  })
  mocks.db.organizationMember.findUnique.mockResolvedValue(null)
  expect(await read()).toMatchObject({ state: 'unavailable' })
  expect(mocks.ready).not.toHaveBeenCalled()
})
it.each(['active', 'expired', 'revoked'])(
  'reports %s invitation without reading a customer workspace',
  async (state) => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
      acceptedAt: null,
      revokedAt: state === 'revoked' ? saved : null,
      expiresAt: new Date(state === 'expired' ? '2020-01-01' : '2099-01-01'),
    })
    expect(await read()).toMatchObject({
      state: 'not_joined',
      invitation: state,
    })
    expect(mocks.ready).not.toHaveBeenCalled()
  },
)
it('returns only milestones from the receipt workspace, never content, keys or transcripts', async () => {
  const result = await read()
  expect(result).toMatchObject({
    state: 'joined',
    businessSaved: true,
    knowledge: { services: true, pricing: true, faqs: true },
    aiConfigured: true,
    websiteSaved: true,
    widgetEnabled: false,
    rehearsal: 'passed',
    nextStep: 'manual_review',
  })
  expect(Object.keys(result).sort()).toEqual(
    [
      'aiConfigured',
      'businessSaved',
      'checkedAt',
      'knowledge',
      'nextStep',
      'rehearsal',
      'state',
      'websiteSaved',
      'widgetEnabled',
    ].sort(),
  )
  expect(mocks.ready).toHaveBeenCalledWith(target, mocks.db)
  expect(mocks.db.organizationMember.findUnique).toHaveBeenCalledWith({
    where: {
      userId_organizationId: { userId: 'owner', organizationId: target },
    },
    select: { id: true },
  })
  expect(mocks.db.aiProviderConfig.findUnique).toHaveBeenCalledWith({
    where: { organizationId: target },
    select: { updatedAt: true },
  })
  expect(mocks.db.knowledgeDocument.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        organizationId: target,
        receptionistApprovedRevision: { equals: 'publishedRevision' },
      }),
      select: { publishedCategory: true, updatedAt: true },
    }),
  )
  const [sql, org] = mocks.db.$queryRaw.mock.calls[0]
  expect(org).toBe(target)
  expect(sql.join('?')).not.toMatch(/"notes"|"title"|SELECT \*|"snapshot",/)
})
it.each(['business', 'knowledge', 'ai', 'website', 'rehearsal'])(
  'identifies the %s next step',
  async (step) => {
    if (step === 'business')
      mocks.ready.mockResolvedValue({
        hasSavedBusiness: false,
        hasOrganizationAi: true,
      })
    if (step === 'knowledge')
      mocks.db.knowledgeDocument.findMany.mockResolvedValue([
        { publishedCategory: 'GENERAL', updatedAt: saved },
      ])
    if (step === 'ai')
      mocks.ready.mockResolvedValue({
        hasSavedBusiness: true,
        hasOrganizationAi: false,
      })
    if (step === 'website')
      mocks.db.websiteReceptionistConfig.findUnique.mockResolvedValue(null)
    if (step === 'rehearsal') mocks.db.$queryRaw.mockResolvedValue([])
    expect(await read()).toMatchObject({ nextStep: step })
  },
)
it.each(['unreviewed', 'needs_work'])(
  'does not treat %s rehearsal as completed',
  async (verdict) => {
    mocks.db.$queryRaw.mockResolvedValue([
      {
        verdict,
        createdAt: run,
        updatedAt: run,
        settingsVersion: saved.toISOString(),
        finished: 'true',
      },
    ])
    expect(await read()).toMatchObject({
      rehearsal: verdict,
      nextStep: 'rehearsal',
    })
  },
)
it('requires a finished rehearsal and exact saved business version', async () => {
  mocks.db.$queryRaw.mockResolvedValue([
    {
      verdict: 'passed',
      createdAt: run,
      updatedAt: run,
      settingsVersion: saved.toISOString(),
      finished: 'false',
    },
  ])
  expect(await read()).toMatchObject({
    rehearsal: 'incomplete',
    nextStep: 'rehearsal',
  })
  mocks.db.$queryRaw.mockResolvedValue([
    {
      verdict: 'passed',
      createdAt: run,
      updatedAt: run,
      settingsVersion: '2026-11-03T00:00:00.000Z',
      finished: 'true',
    },
  ])
  expect(await read()).toMatchObject({
    rehearsal: 'stale',
    nextStep: 'rehearsal',
  })
})
it('marks a reviewed rehearsal stale after configuration or approved document changes', async () => {
  mocks.db.aiProviderConfig.findUnique.mockResolvedValue({
    updatedAt: new Date('2026-11-04T03:00:00Z'),
  })
  expect(await read()).toMatchObject({ rehearsal: 'stale' })
  mocks.db.aiProviderConfig.findUnique.mockResolvedValue({ updatedAt: saved })
  mocks.db.knowledgeDocument.findMany.mockResolvedValue([
    { publishedCategory: 'FAQ', updatedAt: new Date('2026-11-04T03:00:00Z') },
  ])
  mocks.db.knowledgeDocument.aggregate.mockResolvedValue({
    _max: { updatedAt: new Date('2026-11-04T03:00:00Z') },
  })
  expect(await read()).toMatchObject({ rehearsal: 'stale' })
})

it('rechecks staff inside the transaction before reading the source', async () => {
  mocks.staff
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(
      new AppError('FORBIDDEN', 'Flowrish staff access is required.', 403),
    )
  await expect(read()).rejects.toMatchObject({ statusCode: 403 })
  expect(mocks.db.waitlist.findUnique).not.toHaveBeenCalled()
  expect(mocks.ready).not.toHaveBeenCalled()
})
it.each(['organizationId', 'acceptedById'])(
  'rejects an accepted receipt without %s before reading customer setup',
  async (field) => {
    mocks.db.waitlistPilotInvite.findUnique.mockResolvedValue({
      acceptedAt: saved,
      acceptedById: 'owner',
      organizationId: target,
      [field]: null,
    })
    expect(await read()).toMatchObject({ state: 'unavailable' })
    expect(mocks.ready).not.toHaveBeenCalled()
    expect(mocks.db.organizationMember.findUnique).not.toHaveBeenCalled()
  },
)

it('stales removed or unapproved knowledge even when every category remains approved', async () => {
  mocks.db.knowledgeDocument.aggregate.mockResolvedValue({
    _max: { updatedAt: new Date('2026-11-04T03:00:00Z') },
  })
  expect(await read()).toMatchObject({
    knowledge: { services: true, pricing: true, faqs: true },
    rehearsal: 'stale',
    nextStep: 'rehearsal',
  })
  expect(mocks.db.knowledgeDocument.aggregate).toHaveBeenCalledWith({
    where: { organizationId: target },
    _max: { updatedAt: true },
  })
})
