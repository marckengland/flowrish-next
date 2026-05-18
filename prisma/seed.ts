import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

// ─── Permission Keys ─────────────────────────────────────────────────────────

const ALL_PERMISSIONS = [
  "leads:read",
  "leads:write",
  "leads:delete",
  "contacts:read",
  "contacts:write",
  "cadences:manage",
  "cadences:read",
  "users:invite",
  "users:manage",
  "billing:manage",
  "settings:manage",
  "audit:read",
  "forecast:read",
  "forecast:submit",
] as const;

const OWNER_PERMISSIONS = [...ALL_PERMISSIONS];

const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter(
  (p) => p !== "billing:manage"
);

const MANAGER_PERMISSIONS = [
  "leads:read",
  "leads:write",
  "leads:delete",
  "contacts:read",
  "contacts:write",
  "cadences:manage",
  "cadences:read",
  "users:invite",
  "settings:manage",
  "forecast:read",
  "forecast:submit",
];

const MEMBER_PERMISSIONS = [
  "leads:read",
  "leads:write",
  "contacts:read",
  "contacts:write",
  "cadences:read",
  "forecast:read",
  "forecast:submit",
];

// ─── Default Roles ───────────────────────────────────────────────────────────

const DEFAULT_ROLES = [
  { name: "OWNER", hierarchy: 0, permissions: OWNER_PERMISSIONS },
  { name: "ADMIN", hierarchy: 1, permissions: ADMIN_PERMISSIONS },
  { name: "MANAGER", hierarchy: 2, permissions: MANAGER_PERMISSIONS },
  { name: "MEMBER", hierarchy: 3, permissions: MEMBER_PERMISSIONS },
] as const;

// ─── Default Pipeline Stages ─────────────────────────────────────────────────

const DEFAULT_STAGES = [
  { name: "New", order: 1, isClosedWon: false, isClosedLost: false },
  { name: "Qualified", order: 2, isClosedWon: false, isClosedLost: false },
  { name: "Demoed", order: 3, isClosedWon: false, isClosedLost: false },
  { name: "Sent Proposal", order: 4, isClosedWon: false, isClosedLost: false },
  { name: "Closed Won", order: 5, isClosedWon: true, isClosedLost: false },
  { name: "Closed Lost", order: 6, isClosedWon: false, isClosedLost: true },
];

// ─── Dev Users ───────────────────────────────────────────────────────────────

const DEV_USERS = [
  {
    email: "owner@flowrish.dev",
    name: "Dev Owner",
    authId: "00000000-0000-0000-0000-000000000001",
  },
  {
    email: "admin@flowrish.dev",
    name: "Dev Admin",
    authId: "00000000-0000-0000-0000-000000000002",
  },
  {
    email: "manager@flowrish.dev",
    name: "Dev Manager",
    authId: "00000000-0000-0000-0000-000000000003",
  },
  {
    email: "member@flowrish.dev",
    name: "Dev Member",
    authId: "00000000-0000-0000-0000-000000000004",
  },
];

// ─── Main Seed Function ──────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding database...\n");

  // 1. Create system default roles (organizationId = null)
  console.log("Creating default roles...");
  const roles: Record<string, string> = {};

  for (const roleDef of DEFAULT_ROLES) {
    // System roles have organizationId = null, which doesn't work well with
    // Prisma's upsert on compound unique. Use findFirst + create instead.
    let role = await prisma.role.findFirst({
      where: { name: roleDef.name, organizationId: null, isSystem: true },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleDef.name,
          organizationId: null,
          isSystem: true,
          hierarchy: roleDef.hierarchy,
          permissions: {
            create: roleDef.permissions.map((key) => ({ key })),
          },
        },
      });
    }

    roles[roleDef.name] = role.id;
    console.log(
      `  ✓ Role: ${roleDef.name} (hierarchy=${roleDef.hierarchy}, permissions=${roleDef.permissions.length})`
    );
  }

  // 2. Create dev users
  console.log("\nCreating dev users...");
  const users: Record<string, string> = {};

  for (const userDef of DEV_USERS) {
    const user = await prisma.user.upsert({
      where: { email: userDef.email },
      update: {},
      create: {
        authId: userDef.authId,
        email: userDef.email,
        name: userDef.name,
      },
    });
    users[userDef.email] = user.id;
    console.log(`  ✓ User: ${userDef.name} (${userDef.email})`);
  }

  // 3. Create a dev organization
  console.log("\nCreating dev organization...");
  const org = await prisma.organization.upsert({
    where: { slug: "flowrish-dev" },
    update: {},
    create: {
      name: "Flowrish Dev",
      slug: "flowrish-dev",
      plan: "enterprise",
    },
  });
  console.log(`  ✓ Organization: ${org.name} (${org.slug})`);

  // 4. Create a default team
  console.log("\nCreating default team...");
  const team = await prisma.team.upsert({
    where: { id: org.id + "-default-team" },
    update: {},
    create: {
      id: org.id + "-default-team",
      name: "Sales",
      organizationId: org.id,
    },
  });
  console.log(`  ✓ Team: ${team.name}`);

  // 5. Add users to organization and team with appropriate roles
  console.log("\nAssigning users to organization and team...");
  const roleAssignments = [
    { email: "owner@flowrish.dev", role: "OWNER" },
    { email: "admin@flowrish.dev", role: "ADMIN" },
    { email: "manager@flowrish.dev", role: "MANAGER" },
    { email: "member@flowrish.dev", role: "MEMBER" },
  ];

  for (const assignment of roleAssignments) {
    const userId = users[assignment.email];
    const roleId = roles[assignment.role];

    // Add to organization
    await prisma.organizationMember.upsert({
      where: {
        userId_organizationId: { userId, organizationId: org.id },
      },
      update: {},
      create: {
        userId,
        organizationId: org.id,
        isDefault: true,
      },
    });

    // Add to team with role
    await prisma.teamMember.upsert({
      where: {
        userId_teamId: { userId, teamId: team.id },
      },
      update: {},
      create: {
        userId,
        teamId: team.id,
        roleId,
      },
    });

    console.log(`  ✓ ${assignment.email} → ${assignment.role}`);
  }

  // 6. Create default pipeline with stages
  console.log("\nCreating default pipeline...");
  const existingPipeline = await prisma.pipeline.findFirst({
    where: { organizationId: org.id, name: "Sales Pipeline" },
  });

  if (!existingPipeline) {
    const pipeline = await prisma.pipeline.create({
      data: {
        name: "Sales Pipeline",
        organizationId: org.id,
        stages: {
          create: DEFAULT_STAGES,
        },
      },
      include: { stages: true },
    });
    console.log(`  ✓ Pipeline: ${pipeline.name}`);
    for (const stage of pipeline.stages) {
      console.log(
        `    - ${stage.name} (order=${stage.order}${stage.isClosedWon ? ", closedWon" : ""}${stage.isClosedLost ? ", closedLost" : ""})`
      );
    }
  } else {
    console.log(`  ⊘ Pipeline already exists: ${existingPipeline.name}`);
  }

  console.log("\n✅ Seed complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
