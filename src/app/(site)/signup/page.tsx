import { Suspense } from 'react';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { SignupForm } from './signup-form';

export default function SignupPage() {
  const google = Boolean(process.env.GOOGLE_CLIENT_ID);
  const github = Boolean(process.env.GITHUB_CLIENT_ID);

  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-4 py-12">
          <Card className="w-full">
            <CardHeader>
              <CardTitle className="type-h1">Stop guessing what to use</CardTitle>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <SignupForm google={google} github={github} />
    </Suspense>
  );
}
