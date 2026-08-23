import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // Stripe subscription client plugin is registered when STRIPE is configured
  // server-side; client methods no-op gracefully if the plugin is absent.
});
