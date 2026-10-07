import { Skeleton, SkeletonPage } from "@/components/motion/skeleton";

// Same loading look as the dashboard and communities: the logo animation over a page-shaped placeholder.
export default function Loading() {
  return (
    <SkeletonPage label="Loading the team">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-24 rounded-lg" />
      <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
    </SkeletonPage>
  );
}
