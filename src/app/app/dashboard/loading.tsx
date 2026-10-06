import { Skeleton, SkeletonPage } from "@/components/motion/skeleton";

// S-03 / G-27: the same shape as the dashboard, so the page does not jump when the data arrives (G-48).
export default function Loading() {
  return (
    <SkeletonPage label="Loading the dashboard">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-28 rounded-lg" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
      <Skeleton className="h-48 rounded-lg" />
    </SkeletonPage>
  );
}
