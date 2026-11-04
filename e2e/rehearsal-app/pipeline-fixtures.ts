import { coreLead } from './core-fixtures'
export const pipelineIds = {
  pipeline: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  new: '11111111-1111-4111-8111-111111111111',
  qualified: '22222222-2222-4222-8222-222222222222',
  won: '33333333-3333-4333-8333-333333333333',
  lost: '44444444-4444-4444-8444-444444444444',
  lead: '55555555-5555-4555-8555-555555555555',
}
export const pipelineStages = [
  { id: pipelineIds.new, name: 'New', order: 1, isClosedWon: false, isClosedLost: false },
  { id: pipelineIds.qualified, name: 'Qualified', order: 2, isClosedWon: false, isClosedLost: false },
  { id: pipelineIds.won, name: 'Closed Won', order: 3, isClosedWon: true, isClosedLost: false },
  { id: pipelineIds.lost, name: 'Closed Lost', order: 4, isClosedWon: false, isClosedLost: true },
]
export function pipelineLeads(stageId = pipelineIds.new) {
  return [
    { ...coreLead(), id: pipelineIds.lead, stageId, stage: pipelineStages.find(stage => stage.id === stageId)!, dealValue: 1000, currency: 'USD' },
    { ...coreLead(), id: '66666666-6666-4666-8666-666666666666', firstName: 'Existing', lastName: 'Win', stageId: pipelineIds.won, stage: pipelineStages[2], dealValue: 300, currency: 'USD' },
    { ...coreLead(), id: '77777777-7777-4777-8777-777777777777', firstName: 'Existing', lastName: 'Loss', stageId: pipelineIds.lost, stage: pipelineStages[3], dealValue: 200, currency: 'USD' },
    { ...coreLead(), id: '88888888-8888-4888-8888-888888888888', firstName: 'Peso', lastName: 'Prospect', stageId: pipelineIds.new, stage: pipelineStages[0], dealValue: 10000, currency: 'PHP' },
  ]
}
