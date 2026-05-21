import { describe, it, expect, vi } from 'vitest'

// Mock the Prisma client singleton module to avoid ESM import issues
// with the generated Prisma client (uses import.meta.url).
// vi.mock is hoisted, so we use vi.hoisted to create the mock function.
const { mockExtends } = vi.hoisted(() => {
  const mockExtends = vi.fn().mockImplementation(() => ({
    lead: {},
    contact: {},
    company: {},
    organization: {},
    user: {},
    $extends: mockExtends,
  }))
  return { mockExtends }
})

vi.mock('../client', () => ({
  prisma: {
    lead: {},
    contact: {},
    company: {},
    organization: {},
    user: {},
    $extends: mockExtends,
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

// Import after mocking
import { TENANT_SCOPED_MODELS, createTenantPrisma } from '../middleware'

describe('tenant isolation middleware', () => {
  describe('TENANT_SCOPED_MODELS', () => {
    it('includes all expected tenant-scoped models', () => {
      const expectedModels = [
        'Lead',
        'Contact',
        'Company',
        'Activity',
        'Task',
        'Pipeline',
        'Cadence',
        'CadenceEnrollment',
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
      ]

      for (const model of expectedModels) {
        expect(TENANT_SCOPED_MODELS).toContain(model)
      }
    })

    it('does not include non-tenant models', () => {
      const nonTenantModels = [
        'Organization',
        'OrganizationMember',
        'OrganizationInvite',
        'Team',
        'TeamMember',
        'Role',
        'RolePermission',
        'User',
        'LeadContact',
      ]

      for (const model of nonTenantModels) {
        expect(TENANT_SCOPED_MODELS).not.toContain(model)
      }
    })

    it('has no duplicate entries', () => {
      const uniqueModels = new Set(TENANT_SCOPED_MODELS)
      expect(uniqueModels.size).toBe(TENANT_SCOPED_MODELS.length)
    })
  })

  describe('createTenantPrisma', () => {
    it('throws when organizationId is empty', () => {
      expect(() => createTenantPrisma('')).toThrow(
        'organizationId is required for tenant-scoped Prisma client'
      )
    })

    it('returns an extended Prisma client for valid organizationId', () => {
      const tenantPrisma = createTenantPrisma('org-123')
      expect(tenantPrisma).toBeDefined()
    })

    it('calls $extends on the base prisma client with query extensions', () => {
      mockExtends.mockClear()
      createTenantPrisma('org-456')
      expect(mockExtends).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            $allModels: expect.objectContaining({
              create: expect.any(Function),
              createMany: expect.any(Function),
              createManyAndReturn: expect.any(Function),
              findMany: expect.any(Function),
              findFirst: expect.any(Function),
              findUnique: expect.any(Function),
              findUniqueOrThrow: expect.any(Function),
              update: expect.any(Function),
              updateMany: expect.any(Function),
              delete: expect.any(Function),
              deleteMany: expect.any(Function),
              count: expect.any(Function),
              aggregate: expect.any(Function),
              groupBy: expect.any(Function),
              upsert: expect.any(Function),
            }),
          }),
        })
      )
    })
  })
})
