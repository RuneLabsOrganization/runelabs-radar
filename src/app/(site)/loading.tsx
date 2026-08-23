import { Skeleton } from '@/components/ui/skeleton';

export default function SiteLoading() {
  return (
    <div className="mx-auto max-w-[860px] space-y-4 px-6 py-10">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <div className="mt-8 space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
