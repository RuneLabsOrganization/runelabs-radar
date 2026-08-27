'use client';

import { authClient } from '@/lib/auth/client';
import { Button } from '@/components/ui/button';

export function SocialButtons({
  google,
  github,
  callbackURL,
  disabled = false,
}: {
  google: boolean;
  github: boolean;
  callbackURL: string;
  disabled?: boolean;
}) {
  if (!google && !github) return null;
  return (
    <div className="space-y-2">
      {google && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => void authClient.signIn.social({ provider: 'google', callbackURL })}
        >
          Continue with Google
        </Button>
      )}
      {github && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => void authClient.signIn.social({ provider: 'github', callbackURL })}
        >
          Continue with GitHub
        </Button>
      )}
    </div>
  );
}
