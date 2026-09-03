import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { stripe, type StripePlan } from '@better-auth/stripe';
import Stripe from 'stripe';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { config } from '../config';
import { quotaFor, type Tier } from '../billing';
import { tierFromStripeStatus } from '../billing-stripe';
import { sendRadarEmail } from '../email';

const stripeClient =
  process.env.STRIPE_SECRET_KEY != null && process.env.STRIPE_SECRET_KEY.length > 0
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

if (stripeClient && !process.env.STRIPE_WEBHOOK_SECRET) {
  // Without the webhook the stripe plugin is skipped entirely: checkout
  // succeeds but subscription grants never arrive. Loud, not silent.
  console.warn(
    '[billing] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — the Stripe webhook plugin is ' +
      'disabled, so paid subscriptions will never be granted. Set STRIPE_WEBHOOK_SECRET.',
  );
}

function ensureDomainUser(authUserId: string, name: string, email: string | null, emailVerified = false) {
  const db = getDb();
  const existing = db.select().from(schema.users).where(eq(schema.users.authUserId, authUserId)).get();
  if (existing) return existing;
  const emailOwner = email
    ? db.select().from(schema.users).where(eq(schema.users.email, email)).get()
    : null;
  if (emailOwner) {
    // Link to a pre-existing domain user only when the provider verified the
    // email — password signup doesn't require verification, so an unverified
    // signup must never attach to someone else's row (account takeover).
    if (emailVerified) {
      db.update(schema.users)
        .set({ authUserId, email, emailVerified: true })
        .where(eq(schema.users.id, emailOwner.id))
        .run();
      return { ...emailOwner, authUserId, email, emailVerified: true };
    }
    // Unverified collision: create a separate profile without claiming the
    // email (users.email is UNIQUE; the auth-side row keeps the address).
    email = null;
  }
  // unique name: derive from email local-part or auth id
  const base = (name || email?.split('@')[0] || 'member').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'member';
  const nameTaken = (candidate: string) =>
    !!db.select().from(schema.users).where(eq(schema.users.name, candidate)).get();
  // Bounded: 50 sequential candidates, then a random suffix. The name is
  // attacker-chosen — an unbounded loop would let each colliding candidate
  // cost a DB query under the attacker's control.
  let candidate = base;
  let n = 0;
  while (n < 50 && nameTaken(candidate)) {
    n += 1;
    candidate = `${base}${n}`;
  }
  if (n === 50 && nameTaken(candidate)) candidate = `${base}-${randomBytes(4).toString('hex')}`;
  const inserted = db
    .insert(schema.users)
    .values({
      name: candidate,
      passwordHash: '',
      email,
      emailVerified: true,
      authUserId,
      role: 'member',
    })
    .returning()
    .get();
  db.insert(schema.planEntitlements)
    .values({ userId: inserted.id, tier: 'free', plansPerMonth: quotaFor('free'), resetDay: 1 })
    .onConflictDoNothing()
    .run();
  return inserted;
}

/**
 * Sync the domain entitlement with the Stripe-driven tier.
 *
 * plansPerMonth semantics: a stored quota that differs from the OLD tier's
 * default is an admin-granted override, and Stripe syncs (renewals, plan
 * changes, downgrades) must not erase it — the override is sticky until an
 * admin changes it. When the stored quota still equals the old tier's
 * default, it tracks the new tier's default instead.
 */
function setTierForAuthUser(authUserId: string, tier: Tier) {
  const db = getDb();
  const u = db.select().from(schema.users).where(eq(schema.users.authUserId, authUserId)).get();
  if (!u) return;
  const existing = db
    .select()
    .from(schema.planEntitlements)
    .where(eq(schema.planEntitlements.userId, u.id))
    .get();
  if (!existing) {
    db.insert(schema.planEntitlements)
      .values({ userId: u.id, tier, plansPerMonth: quotaFor(tier), resetDay: 1 })
      .onConflictDoNothing()
      .run();
    return;
  }
  const customQuota = existing.plansPerMonth !== quotaFor(existing.tier);
  db.update(schema.planEntitlements)
    .set(customQuota ? { tier } : { tier, plansPerMonth: quotaFor(tier) })
    .where(eq(schema.planEntitlements.userId, u.id))
    .run();
}

const STRIPE_PLANS: StripePlan[] = [
  {
    name: 'builder',
    priceId: process.env.STRIPE_PRICE_BUILDER ?? 'price_builder',
    annualDiscountPriceId: process.env.STRIPE_PRICE_BUILDER_ANNUAL,
  },
  {
    name: 'factory',
    priceId: process.env.STRIPE_PRICE_FACTORY ?? 'price_factory',
    annualDiscountPriceId: process.env.STRIPE_PRICE_FACTORY_ANNUAL,
  },
];

/**
 * Resolved at checkout-call time by the plugin (plans as a function). The
 * 'price_builder'/'price_factory' literals are placeholders, not real Stripe
 * prices — fail fast with a clear error instead of letting the checkout
 * session die deep inside Stripe with an opaque "No such price". Async on
 * purpose: the plugin's init also probes plans() and only handles rejections,
 * not synchronous throws.
 */
export async function checkoutPlans(): Promise<StripePlan[]> {
  for (const plan of STRIPE_PLANS) {
    if (plan.priceId === `price_${plan.name}`) {
      throw new Error(
        `[billing] STRIPE_PRICE_${plan.name.toUpperCase()} is not configured (still the placeholder ` +
          `"${plan.priceId}") — set it to a real Stripe price id before checkout can work.`,
      );
    }
  }
  return STRIPE_PLANS;
}

/**
 * Generic Stripe event hook (the plugin's `onEvent` receives every event,
 * including ones with no dedicated callback). Handles chargebacks: a FULLY
 * refunded charge means the payment was reversed, so the paid tier it granted
 * is dropped to free. Partial refunds keep the tier but are logged for ops.
 */
export async function handleStripeEvent(event: { type: string; data: { object: unknown } }): Promise<void> {
  if (event.type !== 'charge.refunded') return;
  const charge = event.data.object as Stripe.Charge;
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id;
  if (!customerId) return;
  if (typeof charge.amount !== 'number' || charge.amount_refunded < charge.amount) {
    console.warn(
      `[billing] partial refund on Stripe customer ${customerId} ` +
        `(${charge.amount_refunded}/${charge.amount}) — tier unchanged, review manually`,
    );
    return;
  }
  const db = getDb();
  const authRow = db.select().from(schema.authUser).where(eq(schema.authUser.stripeCustomerId, customerId)).get();
  if (!authRow) {
    console.warn(`[billing] full refund for unknown Stripe customer ${customerId} — no entitlement changed`);
    return;
  }
  console.warn(`[billing] full refund (charge ${charge.id}) for ${customerId} — downgrading to free`);
  setTierForAuthUser(authRow.id, 'free');
}

const plugins = [];
if (stripeClient && process.env.STRIPE_WEBHOOK_SECRET) {
  plugins.push(
    stripe({
      stripeClient,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      createCustomerOnSignUp: true,
      onEvent: handleStripeEvent,
      subscription: {
        enabled: true,
        plans: checkoutPlans,
        onSubscriptionComplete: async ({ subscription }) => {
          const tier = (subscription.plan === 'factory' ? 'factory' : 'builder') as Tier;
          setTierForAuthUser(subscription.referenceId, tier);
        },
        onSubscriptionUpdate: async ({ subscription }) => {
          const action = tierFromStripeStatus(subscription.status);
          if (action === 'keep-paid') {
            const tier = (subscription.plan === 'factory' ? 'factory' : 'builder') as Tier;
            setTierForAuthUser(subscription.referenceId, tier);
          } else if (action === 'free') {
            setTierForAuthUser(subscription.referenceId, 'free');
          }
        },
        onSubscriptionCancel: async ({ subscription }) => {
          if (tierFromStripeStatus(subscription.status) === 'free') {
            setTierForAuthUser(subscription.referenceId, 'free');
          }
        },
        onSubscriptionDeleted: async ({ subscription }) => {
          setTierForAuthUser(subscription.referenceId, 'free');
        },
      },
    }),
  );
}

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'sqlite',
    schema: {
      user: schema.authUser,
      session: schema.authSession,
      account: schema.authAccount,
      verification: schema.authVerification,
      subscription: schema.subscription,
    },
  }),
  baseURL: config.siteUrl,
  secret: process.env.BETTER_AUTH_SECRET ?? config.sessionSecret,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }) => {
      await sendRadarEmail({
        to: user.email,
        subject: 'Reset your Radar password',
        html: `<p>Reset your password:</p><p><a href="${url}">${url}</a></p>`,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendRadarEmail({
        to: user.email,
        subject: 'Verify your Radar email',
        html: `<p>Verify your email:</p><p><a href="${url}">${url}</a></p>`,
      });
    },
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
          },
        }
      : {}),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          ensureDomainUser(user.id, user.name, user.email, user.emailVerified);
        },
      },
    },
  },
  plugins,
});

export type AuthSession = typeof auth.$Infer.Session;

/** Resolve Better Auth session user → domain integer user. */
export function domainUserFromAuthId(authUserId: string) {
  return getDb().select().from(schema.users).where(eq(schema.users.authUserId, authUserId)).get() ?? null;
}

export { ensureDomainUser, setTierForAuthUser, stripeClient };
