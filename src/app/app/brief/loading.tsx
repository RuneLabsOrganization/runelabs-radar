import { Skeleton } from '@/components/ui/skeleton';

export default function BriefLoading() {
  return (
    <div className="mx-auto max-w-[860px] space-y-4 px-6 py-7">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="mt-8 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <div className="mt-6 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}
