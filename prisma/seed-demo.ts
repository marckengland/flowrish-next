/**
 * Demo data seeder — populates ONE target organization with realistic,
 * clearly-labeled demo data so every data-driven feature can be tested
 * without filling forms by hand.
 *
 * SAFETY (this can run against production):
 *  - Targets a single org, resolved from SEED_ORG_SLUG or SEED_USER_EMAIL
 *    (falls back to E2E_TEST_USER_EMAIL). It prints the resolved org and
 *    refuses to write unless SEED_DEMO_CONFIRM=yes.
 *  - Every row is marked so it can be found + removed:
 *      companies  → name ends with " (DEMO)"
 *      leads      → description starts with "[DEMO]"
 *      contacts   → attached to demo companies
 *      cadences   → name starts with "[DEMO] "
 *      rules      → config.demo === true
 *      forecast   → notes starts with "[DEMO]"
 *  - It is idempotent: it CLEANS existing demo rows first, then recreates.
 *  - Run `SEED_DEMO_CLEAN=1` to only remove demo data.
 *
 * Run:
 *   npm run seed:demo          # clean + create
 *   npm run seed:demo:clean    # remove demo data only
 */
import { PrismaClient, type ActivityType } from '@prisma/client'

const prisma = new PrismaClient()

const DEMO_COMPANY_SUFFIX = ' (DEMO)'
const DEMO_LEAD_MARKER = '[DEMO]'
const DEMO_CADENCE_PREFIX = '[DEMO] '

// ─── Target resolution ───────────────────────────────────────────────────────

interface Target {
  orgId: string
  orgName: string
  userId: string
  userName: string
}

async function resolveTarget(): Promise<Target> {
  const slug = process.env.SEED_ORG_SLUG?.trim()
  const email = (
    process.env.SEED_USER_EMAIL
    ?? process.env.E2E_TEST_USER_EMAIL
    ?? ''
  )
    .trim()
    .toLowerCase()

  let orgId: string | null = null
  let orgName = ''
  let userId: string | null = null
  let userName = ''

  if (slug) {
    const org = await prisma.organization.findUnique({ where: { slug } })
    if (!org) throw new Error(`No organization with slug "${slug}".`)
    orgId = org.id
    orgName = org.name
    // Pick an owner/first member as the acting user.
    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: org.id },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    })
    if (!member) throw new Error(`Organization "${org.name}" has no members.`)
    userId = member.userId
    userName = member.user.name
  } else if (email) {
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) throw new Error(`No user with email "${email}".`)
    const member = await prisma.organizationMember.findFirst({
      where: { userId: user.id },
      include: { organization: true },
      orderBy: [{ isDefault: 'desc' }, { joinedAt: 'asc' }],
    })
    if (!member) {
      throw new Error(`User "${email}" is not a member of any organization.`)
    }
    orgId = member.organizationId
    orgName = member.organization.name
    userId = user.id
    userName = user.name
  } else {
    throw new Error(
      'Set SEED_ORG_SLUG or SEED_USER_EMAIL (or E2E_TEST_USER_EMAIL) to pick a target org.',
    )
  }

  return { orgId: orgId!, orgName, userId: userId!, userName }
}

// ─── Cleanup (FK-safe order) ─────────────────────────────────────────────────

async function cleanDemo(orgId: string): Promise<void> {
  const companies = await prisma.company.findMany({
    where: { organizationId: orgId, name: { endsWith: DEMO_COMPANY_SUFFIX } },
    select: { id: true },
  })
  const companyIds = companies.map((c) => c.id)

  const leads = await prisma.lead.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { description: { startsWith: DEMO_LEAD_MARKER } },
        companyIds.length ? { companyId: { in: companyIds } } : { id: '' },
      ],
    },
    select: { id: true },
  })
  const leadIds = leads.map((l) => l.id)

  const cadences = await prisma.cadence.findMany({
    where: { organizationId: orgId, name: { startsWith: DEMO_CADENCE_PREFIX } },
    select: { id: true },
  })
  const cadenceIds = cadences.map((c) => c.id)

  // Enrollments (+ their execution logs) reference leads AND cadences with
  // restrict semantics, so remove them before leads/cadences.
  const enrollments = await prisma.cadenceEnrollment.findMany({
    where: {
      organizationId: orgId,
      OR: [
        cadenceIds.length ? { cadenceId: { in: cadenceIds } } : { id: '' },
        leadIds.length ? { leadId: { in: leadIds } } : { id: '' },
      ],
    },
    select: { id: true },
  })
  const enrollmentIds = enrollments.map((e) => e.id)

  if (enrollmentIds.length) {
    await prisma.stepExecutionLog.deleteMany({
      where: { enrollmentId: { in: enrollmentIds } },
    })
    await prisma.cadenceEnrollment.deleteMany({
      where: { id: { in: enrollmentIds } },
    })
  }

  // Leads cascade to activities/tasks/stageTransitions/scoreHistory/leadContact.
  if (leadIds.length) {
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } })
  }

  // Cadences cascade to steps + step attachments.
  if (cadenceIds.length) {
    await prisma.cadence.deleteMany({ where: { id: { in: cadenceIds } } })
  }

  if (companyIds.length) {
    await prisma.contact.deleteMany({
      where: { organizationId: orgId, companyId: { in: companyIds } },
    })
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } })
  }

  // Rules + forecast: identified by marker.
  const scoringRules = await prisma.scoringRule.findMany({
    where: { organizationId: orgId },
    select: { id: true, config: true },
  })
  const demoScoringIds = scoringRules
    .filter((r) => isDemoConfig(r.config))
    .map((r) => r.id)
  if (demoScoringIds.length) {
    await prisma.scoringRule.deleteMany({ where: { id: { in: demoScoringIds } } })
  }

  const assignmentRules = await prisma.assignmentRule.findMany({
    where: { organizationId: orgId },
    select: { id: true, config: true },
  })
  const demoAssignIds = assignmentRules
    .filter((r) => isDemoConfig(r.config))
    .map((r) => r.id)
  if (demoAssignIds.length) {
    await prisma.assignmentRule.deleteMany({
      where: { id: { in: demoAssignIds } },
    })
  }

  await prisma.forecastSubmission.deleteMany({
    where: { organizationId: orgId, notes: { startsWith: DEMO_LEAD_MARKER } },
  })

  console.log(
    `  🧹 Removed demo data: ${leadIds.length} leads, ${cadenceIds.length} cadences, ${companyIds.length} companies, ${enrollmentIds.length} enrollments, ${demoScoringIds.length + demoAssignIds.length} rules.`,
  )
}

function isDemoConfig(config: unknown): boolean {
  return (
    !!config
    && typeof config === 'object'
    && (config as Record<string, unknown>).demo === true
  )
}

// ─── Create ──────────────────────────────────────────────────────────────────

async function getStages(orgId: string) {
  let pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: orgId },
    include: { stages: { orderBy: { order: 'asc' } } },
  })
  if (!pipeline || pipeline.stages.length === 0) {
    pipeline = await prisma.pipeline.create({
      data: {
        name: 'Sales Pipeline',
        organizationId: orgId,
        stages: {
          create: [
            { name: 'New', order: 1 },
            { name: 'Qualified', order: 2 },
            { name: 'Demoed', order: 3 },
            { name: 'Sent Proposal', order: 4 },
            { name: 'Closed Won', order: 5, isClosedWon: true },
            { name: 'Closed Lost', order: 6, isClosedLost: true },
          ],
        },
      },
      include: { stages: { orderBy: { order: 'asc' } } },
    })
    console.log('  ✓ Created default pipeline (org had none).')
  }
  const byName = new Map(pipeline.stages.map((s) => [s.name, s.id]))
  return { stages: pipeline.stages, byName }
}

async function createDemo(t: Target): Promise<void> {
  const { orgId, userId } = t
  const { stages, byName } = await getStages(orgId)
  const stageId = (name: string) => byName.get(name) ?? stages[0].id

  // Companies
  const companySpecs = [
    { name: 'Acme Robotics' + DEMO_COMPANY_SUFFIX, industry: 'Manufacturing', website: 'https://acme-robotics.example.com' },
    { name: 'Northwind Traders' + DEMO_COMPANY_SUFFIX, industry: 'Wholesale', website: 'https://northwind.example.com' },
    { name: 'Globex Software' + DEMO_COMPANY_SUFFIX, industry: 'Software / SaaS', website: 'https://globex.example.com' },
  ]
  const companies = []
  for (const spec of companySpecs) {
    companies.push(
      await prisma.company.create({ data: { ...spec, organizationId: orgId } }),
    )
  }

  // Contacts (attached to companies)
  const contactSpecs = [
    { firstName: 'Ada', lastName: 'Lovelace', jobTitle: 'VP Engineering', email: 'ada@acme-robotics.example.com', company: 0 },
    { firstName: 'Grace', lastName: 'Hopper', jobTitle: 'COO', email: 'grace@northwind.example.com', company: 1 },
    { firstName: 'Alan', lastName: 'Turing', jobTitle: 'CTO', email: 'alan@globex.example.com', company: 2 },
    { firstName: 'Katherine', lastName: 'Johnson', jobTitle: 'Head of Ops', email: 'katherine@acme-robotics.example.com', company: 0 },
  ]
  const contacts = []
  for (const c of contactSpecs) {
    contacts.push(
      await prisma.contact.create({
        data: {
          firstName: c.firstName,
          lastName: c.lastName,
          jobTitle: c.jobTitle,
          email: c.email,
          companyId: companies[c.company].id,
          organizationId: orgId,
        },
      }),
    )
  }

  // Leads across stages, with varied score / value / status / tier.
  const leadSpecs = [
    { firstName: 'Marcus', lastName: 'Reeves', stage: 'New', score: 20, dealValue: 8000, status: 'Open', tier: 'TIER_3', company: 0 },
    { firstName: 'Nadia', lastName: 'Okafor', stage: 'Qualified', score: 55, dealValue: 24000, status: 'Working', tier: 'TIER_2', company: 1 },
    { firstName: 'Priya', lastName: 'Nair', stage: 'Demoed', score: 72, dealValue: 45000, status: 'Working', tier: 'TIER_1', company: 2 },
    { firstName: 'Diego', lastName: 'Santos', stage: 'Sent Proposal', score: 84, dealValue: 62000, status: 'Working', tier: 'TIER_1', company: 0 },
    { firstName: 'Wei', lastName: 'Chen', stage: 'Closed Won', score: 95, dealValue: 38000, status: 'Won', tier: 'TIER_2', company: 1 },
    { firstName: 'Fatima', lastName: 'Al-Sayed', stage: 'Closed Lost', score: 30, dealValue: 15000, status: 'Lost', tier: 'TIER_3', company: 2 },
  ]
  const leads = []
  for (const l of leadSpecs) {
    const company = companies[l.company]
    const isWon = l.stage === 'Closed Won'
    const isLost = l.stage === 'Closed Lost'
    leads.push(
      await prisma.lead.create({
        data: {
          firstName: l.firstName,
          lastName: l.lastName,
          email: `${l.firstName.toLowerCase()}@${company.name.replace(DEMO_COMPANY_SUFFIX, '').toLowerCase().replace(/[^a-z]/g, '')}.example.com`,
          description: `${DEMO_LEAD_MARKER} Sample lead for testing (${l.stage}).`,
          stageId: stageId(l.stage),
          score: l.score,
          dealValue: l.dealValue,
          leadStatus: l.status,
          tier: l.tier,
          isClosed: isWon || isLost,
          closeDate: isWon || isLost ? new Date() : null,
          companyId: company.id,
          companyName: company.name,
          companyIndustry: company.industry,
          companyWebsite: company.website,
          assignedUserId: userId,
          organizationId: orgId,
          lastActivityAt: new Date(),
        },
      }),
    )
  }

  // Link a couple of contacts to leads.
  await prisma.leadContact.createMany({
    data: [
      { leadId: leads[0].id, contactId: contacts[0].id },
      { leadId: leads[3].id, contactId: contacts[3].id },
      { leadId: leads[1].id, contactId: contacts[1].id },
    ],
    skipDuplicates: true,
  })

  // Activities on a few leads (feeds timelines / rhythm / conversation AI).
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const activityData: Array<{
    type: ActivityType
    leadId: string
    notes: string
    callDate?: Date
    callDuration?: number
    meetingDate?: Date
  }> = [
    { type: 'NOTE', leadId: leads[0].id, notes: 'Inbound from website contact form.' },
    { type: 'EMAIL', leadId: leads[1].id, notes: 'Sent intro email with one-pager.' },
    { type: 'CALL', leadId: leads[2].id, notes: 'Discovery call — strong interest in automation.', callDate: new Date(now - 2 * day), callDuration: 1320 },
    { type: 'MEETING', leadId: leads[3].id, notes: 'Product demo with the ops team.', meetingDate: new Date(now - 1 * day) },
    { type: 'NOTE', leadId: leads[3].id, notes: 'Proposal sent; awaiting procurement review.' },
    { type: 'CALL', leadId: leads[4].id, notes: 'Verbal commit — moving to contract.', callDate: new Date(now - 5 * day), callDuration: 900 },
  ]
  for (const a of activityData) {
    await prisma.activity.create({
      data: { ...a, createdById: userId, organizationId: orgId },
    })
  }

  // Tasks: open, overdue, and completed.
  await prisma.task.createMany({
    data: [
      { title: 'Follow up on proposal', description: 'Check procurement status.', priority: 'HIGH', dueDate: new Date(now + 2 * day), leadId: leads[3].id, assigneeId: userId, organizationId: orgId },
      { title: 'Send pricing one-pager', priority: 'MEDIUM', dueDate: new Date(now - 1 * day), leadId: leads[1].id, assigneeId: userId, organizationId: orgId },
      { title: 'Schedule discovery call', priority: 'MEDIUM', dueDate: new Date(now - 3 * day), isComplete: true, completedAt: new Date(now - 2 * day), leadId: leads[2].id, assigneeId: userId, organizationId: orgId },
      { title: 'Research account before demo', priority: 'LOW', dueDate: new Date(now + 4 * day), leadId: leads[2].id, assigneeId: userId, organizationId: orgId },
    ],
  })

  // Stage transitions (feeds pipeline movement / forecast history).
  await prisma.stageTransition.createMany({
    data: [
      { leadId: leads[2].id, fromStageId: stageId('Qualified'), toStageId: stageId('Demoed'), userId, organizationId: orgId },
      { leadId: leads[3].id, fromStageId: stageId('Demoed'), toStageId: stageId('Sent Proposal'), userId, organizationId: orgId },
      { leadId: leads[4].id, fromStageId: stageId('Sent Proposal'), toStageId: stageId('Closed Won'), userId, organizationId: orgId },
    ],
  })

  // Score history for one lead.
  await prisma.scoreHistory.createMany({
    data: [
      { leadId: leads[2].id, previousScore: 40, newScore: 60, reason: 'activity_logged', organizationId: orgId },
      { leadId: leads[2].id, previousScore: 60, newScore: 72, reason: 'stage_progression', organizationId: orgId },
    ],
  })

  // Cadences: one ACTIVE (with an enrollment) and one DRAFT.
  const activeCadence = await prisma.cadence.create({
    data: {
      name: DEMO_CADENCE_PREFIX + 'SMB Outbound',
      status: 'ACTIVE',
      createdById: userId,
      organizationId: orgId,
      steps: {
        create: [
          { stepOrder: 1, actionType: 'EMAIL', delayHours: 0, emailSubject: 'Quick question about {Company}', emailBody: '<p>Hi {FirstName}, noticed your team at {Company}…</p>' },
          { stepOrder: 2, actionType: 'CALL', delayHours: 48, taskTitle: 'Call the prospect', taskDescription: 'Reference the intro email.' },
          { stepOrder: 3, actionType: 'EMAIL', delayHours: 72, emailSubject: 'Following up', emailBody: '<p>Circling back in case this got buried…</p>', startNewThread: true },
        ],
      },
    },
  })
  await prisma.cadence.create({
    data: {
      name: DEMO_CADENCE_PREFIX + 'Re-engagement (draft)',
      status: 'DRAFT',
      createdById: userId,
      organizationId: orgId,
      steps: {
        create: [
          { stepOrder: 1, actionType: 'LINKEDIN', delayHours: 0, taskTitle: 'Send a LinkedIn connection' },
          { stepOrder: 2, actionType: 'MANUAL_TASK', delayHours: 24, taskTitle: 'Personalize a re-engagement note' },
        ],
      },
    },
  })

  // Enroll a couple of open leads in the active cadence.
  await prisma.cadenceEnrollment.createMany({
    data: [
      { cadenceId: activeCadence.id, leadId: leads[0].id, enrolledById: userId, status: 'ACTIVE', currentStepOrder: 1, organizationId: orgId },
      { cadenceId: activeCadence.id, leadId: leads[1].id, enrolledById: userId, status: 'ACTIVE', currentStepOrder: 2, organizationId: orgId },
    ],
    skipDuplicates: true,
  })

  // Scoring rules (config.demo marks them for cleanup).
  await prisma.scoringRule.createMany({
    data: [
      { type: 'activity_count', points: 5, config: { demo: true, per: 'activity' }, organizationId: orgId },
      { type: 'deal_value', points: 10, config: { demo: true, threshold: 25000 }, organizationId: orgId },
    ],
  })

  // Assignment rule — pick a non-colliding priority (unique per org).
  const maxPriority = await prisma.assignmentRule.aggregate({
    where: { organizationId: orgId },
    _max: { priority: true },
  })
  await prisma.assignmentRule.create({
    data: {
      type: 'TERRITORY',
      priority: (maxPriority._max.priority ?? 0) + 1,
      config: { demo: true, region: 'Demo Region' },
      organizationId: orgId,
    },
  })

  // Forecast submission for the current period.
  const period = new Date().toISOString().slice(0, 7)
  await prisma.forecastSubmission.create({
    data: {
      userId,
      period,
      commitAmount: 120000,
      notes: `${DEMO_LEAD_MARKER} Demo commit for ${period}.`,
      organizationId: orgId,
    },
  })

  console.log(
    `  ✓ Created ${companies.length} companies, ${contacts.length} contacts, ${leads.length} leads, ${activityData.length} activities, 4 tasks, 2 cadences (+2 enrollments), 3 scoring/assignment rules, 1 forecast.`,
  )
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cleanOnly = process.env.SEED_DEMO_CLEAN === '1'
  const target = await resolveTarget()

  console.log(
    `\n🌱 Demo seed target: "${target.orgName}" (acting as ${target.userName})\n`,
  )

  if (process.env.SEED_DEMO_CONFIRM !== 'yes') {
    console.log(
      'Refusing to write without confirmation. Re-run with SEED_DEMO_CONFIRM=yes\n'
        + '(this writes/removes demo data in the org above — production if that\'s what .env points to).',
    )
    return
  }

  console.log('Cleaning existing demo data…')
  await cleanDemo(target.orgId)

  if (cleanOnly) {
    console.log('\n✅ Clean complete (SEED_DEMO_CLEAN=1).')
    return
  }

  console.log('Creating demo data…')
  await createDemo(target)
  console.log('\n✅ Demo seed complete.')
}

main()
  .catch((e) => {
    console.error('❌ Demo seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
