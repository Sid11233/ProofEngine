import { Skeleton, SkeletonPage } from "@/components/motion/skeleton";

// The same shape as the requests page: header, filter chips, a list of rows.
export default function Loading() {
  return (
    <SkeletonPage label="Loading requests">
      <Skeleton className="h-14 w-72" />
      <div className="flex gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-24 rounded-full" />)}</div>
      <div className="space-y-px overflow-hidden rounded-card">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-none" />)}</div>
    </SkeletonPage>
  );
}
