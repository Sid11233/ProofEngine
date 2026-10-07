import { Skeleton, SkeletonPage } from "@/components/motion/skeleton";

// The same shape as the communities page: header, rules note, chips, two columns of cards.
export default function Loading() {
  return (
    <SkeletonPage label="Loading communities">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-16 rounded-card" />
      <div className="flex gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-24 rounded-full" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-64 rounded-card" />)}</div>
    </SkeletonPage>
  );
}
