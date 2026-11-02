'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

const scenarios = [
  {
    label: 'Pricing and services',
    message: 'What services do you offer, and what do they cost?',
    guidance: 'Use only approved pricing and services. Missing prices should lead to clarification or a callback offer.',
  },
  {
    label: 'Unknown answer',
    message: 'What is the price of a service that is not listed in your approved information?',
    guidance: 'Acknowledge missing information and offer a callback. Do not invent a price.',
  },
  {
    label: 'Request a callback',
    message: 'My name is Jamie Example. Please call me at +12025550123 about a service inquiry.',
    guidance: 'Read back the name, phone number, and reason, then ask for confirmation before completing the preview summary.',
  },
  {
    label: 'Correct callback details',
    message: 'Please correct my name to Jordan Example and my callback number to +12025550124.',
    guidance: 'Read back the corrected details and ask for confirmation again.',
    needsConfirmation: true,
  },
  {
    label: 'Confirm callback',
    message: 'yes',
    guidance: 'Show a preview-only callback summary. No lead, task, or callback should be created.',
    needsConfirmation: true,
  },
]

export function ReceptionistScenarios({ disabled, awaitingConfirmation, onSelect }: {
  disabled: boolean
  awaitingConfirmation: boolean
  onSelect: (message: string) => void
}): React.JSX.Element {
  const [guidance, setGuidance] = useState('')
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">Try a scenario</p>
      <p className="text-xs text-muted-foreground">Choosing a scenario replaces the unsent draft; it does not send. Review it, then select Send caller message. Sending uses your AI allowance when AI is needed. Sample names and numbers are fictional.</p>
      <div className="flex flex-wrap gap-2">
        {scenarios.map((scenario) => <Button key={scenario.label} type="button" variant="outline" size="sm" disabled={disabled || Boolean(scenario.needsConfirmation && !awaitingConfirmation)} onClick={() => {
          if (disabled || (scenario.needsConfirmation && !awaitingConfirmation)) return
          setGuidance(scenario.guidance)
          onSelect(scenario.message)
        }}>{scenario.label}</Button>)}
      </div>
      {!awaitingConfirmation && <p className="text-xs text-muted-foreground">Correction and confirmation scenarios become available after callback details have been read back.</p>}
      {guidance && <p className="text-xs text-muted-foreground" aria-live="polite"><span className="font-medium">Look for: </span>{guidance}</p>}
    </div>
  )
}
