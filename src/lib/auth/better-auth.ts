import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { stripe } from '@better-auth/stripe';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import * as schema from '../db/schema';
import { config } from '../config';
import { quotaFor, type Tier } from '../billing';

const stripeClient =
  process.env.STRIPE_SECRET_KEY != null && process.env.STRIPE_SECRET_KEY.length > 0
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

function ensureDomainUser(authUserId: string, name: string, email: string) {
  const db = getDb();
  const existing = db.select().from(schema.users).where(eq(schema.users.authUserId, authUserId)).get();
  if (existing) return existing;
  const byEmail = email
    ? db.select().from(schema.users).where(eq(schema.users.email, email)).get()
    : null;
  if (byEmail) {
    db.update(schema.users)
      .set({ authUserId, email, emailVerified: true })
      .where(eq(schema.users.id, byEmail.id))
      .run();
    return { ...byEmail, authUserId, email, emailVerified: true };
  }
  // unique name: derive from email local-part or auth id
  let base = (name || email.split('@')[0] || 'member').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'member';
  let candidate = base;
  let n = 0;
  while (db.select().from(schema.users).where(eq(schema.users.name, candidate)).get()) {
    n += 1;
    candidate = `${base}${n}`;
  }
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

function setTierForAuthUser(authUserId: string, tier: Tier) {
  const db = getDb();
  const u = db.select().from(schema.users).where(eq(schema.users.authUserId, authUserId)).get();
  if (!u) return;
  db.insert(schema.planEntitlements)
    .values({ userId: u.id, tier, plansPerMonth: quotaFor(tier), resetDay: 1 })
    .onConflictDoUpdate({
      target: schema.planEntitlements.userId,
      set: { tier, plansPerMonth: quotaFor(tier) },
    })
    .run();
}

const plugins = [];
if (stripeClient && process.env.STRIPE_WEBHOOK_SECRET) {
  plugins.push(
    stripe({
      stripeClient,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      createCustomerOnSignUp: true,
      subscription: {
        enabled: true,
        plans: [
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
        ],
        onSubscriptionComplete: async ({ subscription }) => {
          const tier = (subscription.plan === 'factory' ? 'factory' : 'builder') as Tier;
          setTierForAuthUser(subscription.referenceId, tier);
        },
        onSubscriptionUpdate: async ({ subscription }) => {
          if (subscription.status === 'active' || subscription.status === 'trialing') {
            const tier = (subscription.plan === 'factory' ? 'factory' : 'builder') as Tier;
            setTierForAuthUser(subscription.referenceId, tier);
          }
        },
        onSubscriptionCancel: async ({ subscription }) => {
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
    requireEmailVerification: false, // enable when SMTP is configured
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
          ensureDomainUser(user.id, user.name, user.email);
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
