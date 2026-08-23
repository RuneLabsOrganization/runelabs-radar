import { Skeleton } from '@/components/ui/skeleton';

export default function AppLoading() {
  return (
    <div className="mx-auto max-w-[860px] space-y-4 px-6 py-7">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="mt-6 space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </div>
    </div>
  );
}
