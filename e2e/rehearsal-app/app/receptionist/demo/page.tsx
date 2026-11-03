import { ReceptionistDemo } from '@/components/receptionist/receptionist-demo'
export default function Page() {
  return (
    <ReceptionistDemo
      business={{
        name: 'Flowrish sample',
        services: 'Sales CRM and callback management.',
        pricing: 'Our team will confirm pricing',
        hours: 'Mon–Fri 9am–5pm, Asia/Manila',
        callbackHours: {
          timeZone: 'Asia/Manila',
          opensAt: '09:00',
          closesAt: '17:00',
          businessDays: [1, 2, 3, 4, 5],
          version: '2026-01-01T00:00:00.000Z',
          calendarExceptions: [],
        },
      }}
    />
  )
}
