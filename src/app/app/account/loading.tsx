import { Skeleton } from '@/components/ui/skeleton';

export default function AccountLoading() {
  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-4 h-3 w-16" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="mt-4 h-3 w-24" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
