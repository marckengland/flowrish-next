import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for the cadence enrollment service.
 *
 * Tests cover:
 * - enrollLead: cadence must be ACTIVE, no duplicate ACTIVE enrollment, creates with correct defaults
 * - bulkEnroll: same validations, skips already-enrolled leads
 * - pauseEnrollment: only ACTIVE can be paused
 * - resumeEnrollment: only PAUSED can be resumed
 * - exitEnrollment: sets EXITED with reason, validates reason
 * - completeEnrollment: sets COMPLETED with completedAt
 * - handleReplyReceived / handleMeetingBooked: conditional exits
 *
 * **Validates: Requirements 6.5, 6.6, 6.8, 6.9, 32.1, 32.2, 32.3**
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockDb = {
  cadence: {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  cadenceEnrollment: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  cadenceStep: {
    findMany: vi.fn(),
  },
}

vi.mock('@/server/db/middleware', () => ({
  createTenantPrisma: vi.fn(() => mockDb),
  TENANT_SCOPED_MODELS: ['Cadence', 'CadenceEnrollment', 'CadenceStep'],
}))

vi.mock('@/server/db/client', () => ({
  prisma: {
    $transaction: vi.fn(),
  },
}))

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(),
}))

import {
  enrollLead,
  bulkEnroll,
  pauseEnrollment,
  resumeEnrollment,
  exitEnrollment,
  completeEnrollment,
  handleReplyReceived,
  handleMeetingBooked,
} from '@/server/services/cadences'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Cadence Enrollment Service', () => {
  const orgId = '550e8400-e29b-41d4-a716-446655440000'
  const userId = '660e8400-e29b-41d4-a716-446655440001'
  const cadenceId = '770e8400-e29b-41d4-a716-446655440002'
  const leadId = '880e8400-e29b-41d4-a716-446655440003'
  const enrollmentId = '990e8400-e29b-41d4-a716-446655440004'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ─── enrollLead ──────────────────────────────────────────────────────────

  describe('enrollLead', () => {
    it('creates an enrollment with status ACTIVE and currentStepOrder 1', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ACTIVE',
      })
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue(null)
      mockDb.cadenceEnrollment.create.mockResolvedValue({
        id: enrollmentId,
        cadenceId,
        leadId,
        enrolledById: userId,
        status: 'ACTIVE',
        currentStepOrder: 1,
        enrolledAt: new Date(),
      })

      const result = await enrollLead(cadenceId, leadId, userId, orgId)

      expect(result.status).toBe('ACTIVE')
      expect(result.currentStepOrder).toBe(1)
      expect(result.cadenceId).toBe(cadenceId)
      expect(result.leadId).toBe(leadId)
      expect(result.enrolledById).toBe(userId)
    })

    it('throws NOT_FOUND when cadence does not exist', async () => {
      mockDb.cadence.findFirst.mockResolvedValue(null)

      await expect(
        enrollLead(cadenceId, leadId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws INVALID_STATE when cadence is DRAFT', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
      })

      await expect(
        enrollLead(cadenceId, leadId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws INVALID_STATE when cadence is ARCHIVED', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ARCHIVED',
      })

      await expect(
        enrollLead(cadenceId, leadId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws DUPLICATE_ENROLLMENT when lead already has ACTIVE enrollment', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ACTIVE',
      })
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: 'existing-enrollment',
        cadenceId,
        leadId,
        status: 'ACTIVE',
      })

      await expect(
        enrollLead(cadenceId, leadId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'DUPLICATE_ENROLLMENT',
        statusCode: 409,
      })
    })

    it('throws VALIDATION_ERROR when cadenceId is empty', async () => {
      await expect(
        enrollLead('', leadId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('throws VALIDATION_ERROR when leadId is empty', async () => {
      await expect(
        enrollLead(cadenceId, '', userId, orgId),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })
  })

  // ─── bulkEnroll ──────────────────────────────────────────────────────────

  describe('bulkEnroll', () => {
    const leadId2 = '880e8400-e29b-41d4-a716-446655440005'
    const leadId3 = '880e8400-e29b-41d4-a716-446655440006'

    it('enrolls multiple leads and skips already-enrolled ones', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ACTIVE',
      })
      // leadId2 already has an active enrollment
      mockDb.cadenceEnrollment.findMany.mockResolvedValue([
        { leadId: leadId2 },
      ])
      mockDb.cadenceEnrollment.create.mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: `enrollment-${data.leadId}`,
          ...data,
          enrolledAt: new Date(),
        }),
      )

      const result = await bulkEnroll(
        cadenceId,
        [leadId, leadId2, leadId3],
        userId,
        orgId,
      )

      expect(result.enrolledCount).toBe(2)
      expect(result.skippedCount).toBe(1)
      expect(result.skipped).toContain(leadId2)
      expect(result.enrolled).toHaveLength(2)
    })

    it('throws NOT_FOUND when cadence does not exist', async () => {
      mockDb.cadence.findFirst.mockResolvedValue(null)

      await expect(
        bulkEnroll(cadenceId, [leadId], userId, orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws INVALID_STATE when cadence is not ACTIVE', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'DRAFT',
      })

      await expect(
        bulkEnroll(cadenceId, [leadId], userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws VALIDATION_ERROR when leadIds is empty', async () => {
      await expect(
        bulkEnroll(cadenceId, [], userId, orgId),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })

    it('returns all skipped when all leads already enrolled', async () => {
      mockDb.cadence.findFirst.mockResolvedValue({
        id: cadenceId,
        status: 'ACTIVE',
      })
      mockDb.cadenceEnrollment.findMany.mockResolvedValue([
        { leadId },
        { leadId: leadId2 },
      ])

      const result = await bulkEnroll(
        cadenceId,
        [leadId, leadId2],
        userId,
        orgId,
      )

      expect(result.enrolledCount).toBe(0)
      expect(result.skippedCount).toBe(2)
    })
  })

  // ─── pauseEnrollment ─────────────────────────────────────────────────────

  describe('pauseEnrollment', () => {
    it('pauses an ACTIVE enrollment', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
      })
      mockDb.cadenceEnrollment.update.mockResolvedValue({
        id: enrollmentId,
        status: 'PAUSED',
      })

      const result = await pauseEnrollment(enrollmentId, userId, orgId)

      expect(result.status).toBe('PAUSED')
      expect(mockDb.cadenceEnrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId },
        data: { status: 'PAUSED' },
      })
    })

    it('throws NOT_FOUND when enrollment does not exist', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue(null)

      await expect(
        pauseEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws INVALID_STATE when enrollment is PAUSED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'PAUSED',
      })

      await expect(
        pauseEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws INVALID_STATE when enrollment is COMPLETED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'COMPLETED',
      })

      await expect(
        pauseEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws INVALID_STATE when enrollment is EXITED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'EXITED',
      })

      await expect(
        pauseEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })
  })

  // ─── resumeEnrollment ────────────────────────────────────────────────────

  describe('resumeEnrollment', () => {
    it('resumes a PAUSED enrollment', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'PAUSED',
      })
      mockDb.cadenceEnrollment.update.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
      })

      const result = await resumeEnrollment(enrollmentId, userId, orgId)

      expect(result.status).toBe('ACTIVE')
      expect(mockDb.cadenceEnrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId },
        data: { status: 'ACTIVE' },
      })
    })

    it('throws NOT_FOUND when enrollment does not exist', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue(null)

      await expect(
        resumeEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws INVALID_STATE when enrollment is ACTIVE', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
      })

      await expect(
        resumeEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws INVALID_STATE when enrollment is COMPLETED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'COMPLETED',
      })

      await expect(
        resumeEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws INVALID_STATE when enrollment is EXITED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'EXITED',
      })

      await expect(
        resumeEnrollment(enrollmentId, userId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })
  })

  // ─── exitEnrollment ──────────────────────────────────────────────────────

  describe('exitEnrollment', () => {
    it('exits an ACTIVE enrollment with reply_received reason', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
      })
      mockDb.cadenceEnrollment.update.mockResolvedValue({
        id: enrollmentId,
        status: 'EXITED',
        exitReason: 'reply_received',
      })

      const result = await exitEnrollment(enrollmentId, 'reply_received', orgId)

      expect(result.status).toBe('EXITED')
      expect(result.exitReason).toBe('reply_received')
    })

    it('exits a PAUSED enrollment with meeting_booked reason', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'PAUSED',
      })
      mockDb.cadenceEnrollment.update.mockResolvedValue({
        id: enrollmentId,
        status: 'EXITED',
        exitReason: 'meeting_booked',
      })

      const result = await exitEnrollment(enrollmentId, 'meeting_booked', orgId)

      expect(result.status).toBe('EXITED')
      expect(result.exitReason).toBe('meeting_booked')
    })

    it('exits with manual reason', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
      })
      mockDb.cadenceEnrollment.update.mockResolvedValue({
        id: enrollmentId,
        status: 'EXITED',
        exitReason: 'manual',
      })

      const result = await exitEnrollment(enrollmentId, 'manual', orgId)

      expect(result.status).toBe('EXITED')
      expect(result.exitReason).toBe('manual')
    })

    it('throws NOT_FOUND when enrollment does not exist', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue(null)

      await expect(
        exitEnrollment(enrollmentId, 'manual', orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws INVALID_STATE when enrollment is already EXITED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'EXITED',
      })

      await expect(
        exitEnrollment(enrollmentId, 'manual', orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws INVALID_STATE when enrollment is COMPLETED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'COMPLETED',
      })

      await expect(
        exitEnrollment(enrollmentId, 'manual', orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws VALIDATION_ERROR for invalid exit reason', async () => {
      await expect(
        exitEnrollment(enrollmentId, 'invalid_reason' as any, orgId),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })
  })

  // ─── completeEnrollment ──────────────────────────────────────────────────

  describe('completeEnrollment', () => {
    it('completes an ACTIVE enrollment with completedAt timestamp', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'ACTIVE',
      })
      mockDb.cadenceEnrollment.update.mockResolvedValue({
        id: enrollmentId,
        status: 'COMPLETED',
        completedAt: new Date(),
      })

      const result = await completeEnrollment(enrollmentId, orgId)

      expect(result.status).toBe('COMPLETED')
      expect(result.completedAt).toBeInstanceOf(Date)
      expect(mockDb.cadenceEnrollment.update).toHaveBeenCalledWith({
        where: { id: enrollmentId, status: 'ACTIVE' },
        data: {
          status: 'COMPLETED',
          completedAt: expect.any(Date),
        },
      })
    })

    it('throws NOT_FOUND when enrollment does not exist', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue(null)

      await expect(
        completeEnrollment(enrollmentId, orgId),
      ).rejects.toMatchObject({
        code: 'NOT_FOUND',
        statusCode: 404,
      })
    })

    it('throws INVALID_STATE when enrollment is PAUSED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'PAUSED',
      })

      await expect(
        completeEnrollment(enrollmentId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })

    it('throws INVALID_STATE when enrollment is already COMPLETED', async () => {
      mockDb.cadenceEnrollment.findFirst.mockResolvedValue({
        id: enrollmentId,
        status: 'COMPLETED',
      })

      await expect(
        completeEnrollment(enrollmentId, orgId),
      ).rejects.toMatchObject({
        code: 'INVALID_STATE',
        statusCode: 400,
      })
    })
  })

  // ─── handleReplyReceived ─────────────────────────────────────────────────

  describe('handleReplyReceived', () => {
    it('exits all ACTIVE enrollments for a lead with reply_received reason', async () => {
      mockDb.cadenceEnrollment.updateMany.mockResolvedValue({ count: 2 })

      const result = await handleReplyReceived(leadId, orgId)

      expect(result).toBe(2)
      expect(mockDb.cadenceEnrollment.updateMany).toHaveBeenCalledWith({
        where: {
          leadId,
          status: 'ACTIVE',
        },
        data: {
          status: 'EXITED',
          exitReason: 'reply_received',
        },
      })
    })

    it('returns 0 when lead has no active enrollments', async () => {
      mockDb.cadenceEnrollment.updateMany.mockResolvedValue({ count: 0 })

      const result = await handleReplyReceived(leadId, orgId)

      expect(result).toBe(0)
    })

    it('throws VALIDATION_ERROR when leadId is empty', async () => {
      await expect(
        handleReplyReceived('', orgId),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })
  })

  // ─── handleMeetingBooked ─────────────────────────────────────────────────

  describe('handleMeetingBooked', () => {
    it('exits all ACTIVE enrollments for a lead with meeting_booked reason', async () => {
      mockDb.cadenceEnrollment.updateMany.mockResolvedValue({ count: 1 })

      const result = await handleMeetingBooked(leadId, orgId)

      expect(result).toBe(1)
      expect(mockDb.cadenceEnrollment.updateMany).toHaveBeenCalledWith({
        where: {
          leadId,
          status: 'ACTIVE',
        },
        data: {
          status: 'EXITED',
          exitReason: 'meeting_booked',
        },
      })
    })

    it('returns 0 when lead has no active enrollments', async () => {
      mockDb.cadenceEnrollment.updateMany.mockResolvedValue({ count: 0 })

      const result = await handleMeetingBooked(leadId, orgId)

      expect(result).toBe(0)
    })

    it('throws VALIDATION_ERROR when leadId is empty', async () => {
      await expect(
        handleMeetingBooked('', orgId),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        statusCode: 400,
      })
    })
  })
})
