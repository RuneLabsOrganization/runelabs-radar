import { Skeleton } from '@/components/ui/skeleton';

export default function BuildLoading() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-grat-soft pb-2">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    </div>
  );
}
