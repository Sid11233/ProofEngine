import { Skeleton, SkeletonPage } from "@/components/motion/skeleton";

export default function Loading() {
  return (
    <SkeletonPage label="Loading clients">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
    </SkeletonPage>
  );
}
