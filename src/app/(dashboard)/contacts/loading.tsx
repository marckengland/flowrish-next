import { ListPageSkeleton } from '@/components/skeletons/list-page-skeleton'

export default function ContactsLoading(): React.JSX.Element {
  return <ListPageSkeleton columns={6} minWidth={720} />
}
