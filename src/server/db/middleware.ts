import { prisma } from './client'

/**
 * List of models that are scoped to a tenant (organization).
 * These models have an `organizationId` field that must be injected
 * into all queries and mutations to enforce data isolation.
 */
export const TENANT_SCOPED_MODELS = [
  'Lead',
  'Contact',
  'Company',
  'Activity',
  'Task',
  'Pipeline',
  'Cadence',
  'CadenceEnrollment',
  'CadenceSchedule',
  'CadenceStepAttachment',
  'StepExecutionLog',
  'ScoringRule',
  'ScoreDecayConfig',
  'AssignmentRule',
  'EmailAccount',
  'EmailMessage',
  'AuditEntry',
  'FileAttachment',
  'ForecastSubmission',
  'ForecastSnapshot',
  'CoachingComment',
  'AiPromptConfig',
  'DeletionRequest',
  'FieldMapping',
  'StageTransition',
  'ScoreHistory',
] as const

export type TenantScopedModel = (typeof TENANT_SCOPED_MODELS)[number]

/**
 * Creates a tenant-scoped Prisma client that automatically injects
 * `organizationId` into all queries and mutations for tenant-scoped models.
 *
 * Uses Prisma `$extends` with query extensions (not deprecated middleware).
 *
 * @param organizationId - The organization ID to scope all queries to
 * @returns Extended PrismaClient with tenant isolation enforced
 */
export function createTenantPrisma(organizationId: string) {
  if (!organizationId) {
    throw new Error('organizationId is required for tenant-scoped Prisma client')
  }

  return prisma.$extends({
    query: {
      $allModels: {
        async create({ model, args, query }) {
          if (isTenantScoped(model)) {
            // Prisma's $allModels extension uses a union of all model arg types
            // that cannot be narrowed to a specific model's data shape.
            // At runtime, tenant-scoped models always have an organizationId field.
            const a = args as { data: Record<string, unknown> }
            a.data = { ...a.data, organizationId }
          }
          return query(args)
        },
        async createMany({ model, args, query }) {
          if (isTenantScoped(model)) {
            const a = args as {
              data: Record<string, unknown> | Record<string, unknown>[]
            }
            if (Array.isArray(a.data)) {
              a.data = a.data.map((item) => ({ ...item, organizationId }))
            } else {
              a.data = { ...a.data, organizationId }
            }
          }
          return query(args)
        },
        async createManyAndReturn({ model, args, query }) {
          if (isTenantScoped(model)) {
            const a = args as {
              data: Record<string, unknown> | Record<string, unknown>[]
            }
            if (Array.isArray(a.data)) {
              a.data = a.data.map((item) => ({ ...item, organizationId }))
            } else {
              a.data = { ...a.data, organizationId }
            }
          }
          return query(args)
        },
        async findMany({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId }
          }
          return query(args)
        },
        async findFirst({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId }
          }
          return query(args)
        },
        async findUnique({ model, args, query }) {
          if (isTenantScoped(model)) {
            // findUnique requires unique fields in `where`, so we convert
            // to findFirst with the organizationId filter for safety.
            // However, Prisma $extends doesn't allow changing the operation type,
            // so we add organizationId to the where clause directly.
            args.where = { ...args.where, organizationId } as typeof args.where
          }
          return query(args)
        },
        async findUniqueOrThrow({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId } as typeof args.where
          }
          return query(args)
        },
        async update({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId } as typeof args.where
          }
          return query(args)
        },
        async updateMany({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId }
          }
          return query(args)
        },
        async delete({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId } as typeof args.where
          }
          return query(args)
        },
        async deleteMany({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId }
          }
          return query(args)
        },
        async count({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId }
          }
          return query(args)
        },
        async aggregate({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId }
          }
          return query(args)
        },
        async groupBy({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId }
          }
          return query(args)
        },
        async upsert({ model, args, query }) {
          if (isTenantScoped(model)) {
            args.where = { ...args.where, organizationId } as typeof args.where
            const a = args as { create: Record<string, unknown> }
            a.create = { ...a.create, organizationId }
            // update doesn't need orgId injection (where already filters)
          }
          return query(args)
        },
      },
    },
  })
}

/**
 * Type for the tenant-scoped Prisma client returned by createTenantPrisma.
 */
export type TenantPrismaClient = ReturnType<typeof createTenantPrisma>

/**
 * Check if a model name is tenant-scoped.
 */
function isTenantScoped(model: string | undefined): boolean {
  if (!model) return false
  return (TENANT_SCOPED_MODELS as readonly string[]).includes(model)
}
