/**
 * Map Stripe subscription status to Radar entitlement action.
 * Pure: no db. Portal cancel while still active/trialing is pending-cancel
 * (keep paid through period end). Actual loss of access is canceled/unpaid.
 */
export type StripeTierAction = 'keep-paid' | 'free' | 'ignore';

export function tierFromStripeStatus(status: string): StripeTierAction {
  if (status === 'active' || status === 'trialing') return 'keep-paid';
  if (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') return 'free';
  return 'ignore';
}
