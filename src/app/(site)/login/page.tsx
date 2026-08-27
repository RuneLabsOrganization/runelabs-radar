import { Suspense } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import RadarBackdrop from '@/components/RadarBackdrop';
import { siteMeta } from '@/lib/seo';
import { paths } from '@/lib/urls';
import { LoginForm } from './login-form';

export const metadata = siteMeta('Sign in', 'Sign in to Radar.', paths.login, { index: false });

function LoginFallback() {
  return (
    <Card className="relative w-full max-w-md">
      <CardHeader>
        <Skeleton className="h-7 w-28" />
        <Skeleton className="mt-2 h-4 w-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  const google = Boolean(process.env.GOOGLE_CLIENT_ID);
  const github = Boolean(process.env.GITHUB_CLIENT_ID);

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30">
        <RadarBackdrop intensity={0.12} />
      </div>
      <Suspense fallback={<LoginFallback />}>
        <LoginForm google={google} github={github} />
      </Suspense>
    </div>
  );
}
