import { Skeleton, SkeletonPage } from "@/components/motion/skeleton";

// The same shape as the dashboard (header, next action card, funnel, five-card pipeline), so nothing jumps when data arrives.
export default function Loading() {
  return (
    <SkeletonPage label="Loading the dashboard">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-44 rounded-card" />
      <Skeleton className="h-28 rounded-card" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>
    </SkeletonPage>
  );
}
