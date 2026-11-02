import { beforeEach, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ create: vi.fn(), upsert: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { receptionistConfig: db } }))
import { saveReceptionistConfig } from '../receptionist'
const config = { enabled: false, businessName: 'Sample business', knowledge: '', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1], forwardTo: '', assigneeId: '', stageId: '' }
beforeEach(() => vi.clearAllMocks())
it('creates conditionally without invoking an overwrite operation', async () => {
 db.create.mockResolvedValue({ settings: config })
 expect(await saveReceptionistConfig('org', config, { createOnly: true })).toEqual(config)
 expect(db.create).toHaveBeenCalledWith({ data: { organizationId: 'org', settings: config } })
 expect(db.upsert).not.toHaveBeenCalled()
})
it('returns a precondition failure when another administrator already created settings', async () => {
 db.create.mockRejectedValue({ code: 'P2002' })
 await expect(saveReceptionistConfig('org', config, { createOnly: true })).rejects.toMatchObject({ statusCode: 412, code: 'CONFIG_EXISTS' })
 expect(db.upsert).not.toHaveBeenCalled()
})
