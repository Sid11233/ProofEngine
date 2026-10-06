import { Skeleton, SkeletonPage } from "@/components/motion/skeleton";

// S-03 / G-27: a list-shaped placeholder, same width and row height as the page, so nothing jumps when data arrives.
export default function Loading() {
  return (
    <SkeletonPage label="Loading case studies">
      <Skeleton className="h-8 w-48" />
      <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
    </SkeletonPage>
  );
}
