export type ReceptionistCheckId = 'business' | 'hours' | 'knowledge' | 'callbacks' | 'ai'
export interface ReceptionistSetupCheck {
  id: ReceptionistCheckId
  label: string
  status: 'complete' | 'attention'
  detail: string
}
export interface ReceptionistChecklist {
  scope: 'saved_setup'
  checkedAt: string
  settingsVersion: string | null
  checks: ReceptionistSetupCheck[]
}
