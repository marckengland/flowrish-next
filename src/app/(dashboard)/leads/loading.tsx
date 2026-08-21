import { ListPageSkeleton } from '@/components/skeletons/list-page-skeleton'

export default function LeadsLoading(): React.JSX.Element {
  return <ListPageSkeleton columns={7} minWidth={860} />
}
