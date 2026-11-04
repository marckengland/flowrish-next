import { ForecastFixture } from '../../components/pipeline-forecast-fixture'
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  return <ForecastFixture readOnly={(await searchParams).readonly === '1'} />
}
