import { PipelineFixture } from '../../components/pipeline-forecast-fixture'
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  return <PipelineFixture readOnly={params.readonly === '1'} empty={params.empty === '1'} />
}
