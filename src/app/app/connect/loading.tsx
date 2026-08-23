import { Skeleton } from '@/components/ui/skeleton';

export default function ConnectLoading() {
  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-16 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
