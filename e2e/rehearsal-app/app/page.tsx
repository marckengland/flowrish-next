import { WaitlistForm } from '@/components/marketing/waitlist-form'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>
}) {
  const params = await searchParams
  return (
    <section id="waitlist" className="mx-auto max-w-md space-y-5 p-6">
      <h1 className="text-2xl font-semibold">Join the waitlist</h1>
      <WaitlistForm
        source={
          params.source === 'receptionist-demo' ? 'public_demo' : 'landing'
        }
      />
    </section>
  )
}
