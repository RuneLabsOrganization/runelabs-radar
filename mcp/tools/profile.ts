import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { can } from '../../src/lib/entitlements';
import { getProfile, getSession, setProfile, setSession } from '../../src/lib/personalization';
import { envelopeSchema, respond, withUserEconomy } from '../lib/payload';
import type { AuthContext } from '../lib/auth';

const capitalBand = z.enum(['bootstrap', 'small', 'comfortable', 'funded']);

function needAuth(auth: AuthContext) {
  if (auth.userId != null) return null;
  return respond(
    { ok: false, error: 'sign in required — connect with an OAuth token that has a user' },
    {
      summary: 'Sign in required for profile/session tools.',
      economy: withUserEconomy(auth.userId, 'read'),
      next: [{ tool: 'get_server_guide', arguments: {}, reason: 'how to authenticate this MCP server' }],
    },
  );
}

export function registerProfileTools(server: McpServer, auth: AuthContext): void {
  server.registerTool(
    'get_profile',
    {
      description:
        'Read your personalization profile (skills, interests, capital band, avoided sectors). Used to rerank openings and seed scout defaults.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        profile: z
          .object({
            skills: z.array(z.string()),
            interests: z.array(z.string()),
            capital_band: capitalBand.nullable(),
            avoided_sectors: z.array(z.string()),
            updated_at: z.string(),
          })
          .nullable()
          .optional(),
      },
    },
    async () => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const profile = getProfile(auth.userId!);
      return respond(
        {
          ok: true,
          profile: profile
            ? {
                skills: profile.skills,
                interests: profile.interests,
                capital_band: profile.capitalBand,
                avoided_sectors: profile.avoidedSectors,
                updated_at: profile.updatedAt,
              }
            : null,
        },
        {
          summary: profile
            ? `Profile: ${profile.skills.length} skills, ${profile.interests.length} interests.`
            : 'No profile set yet — use set_profile (Builder+).',
          economy: withUserEconomy(auth.userId, 'read'),
          next: profile
            ? [{ tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'openings reranked by your fit' }]
            : [{ tool: 'set_profile', arguments: { skills: [], interests: [] }, reason: 'create a profile (Builder+)' }],
        },
      );
    },
  );

  server.registerTool(
    'set_profile',
    {
      description:
        'Update your personalization profile (Builder+). Partial patch — omit fields you do not want to change.',
      inputSchema: {
        skills: z.array(z.string().min(1).max(60)).max(20).optional(),
        interests: z.array(z.string().min(1).max(60)).max(20).optional(),
        capital_band: capitalBand.optional(),
        avoided_sectors: z.array(z.string().min(1).max(60)).max(20).optional(),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        profile: z
          .object({
            skills: z.array(z.string()),
            interests: z.array(z.string()),
            capital_band: capitalBand.nullable(),
            avoided_sectors: z.array(z.string()),
            updated_at: z.string(),
          })
          .optional(),
      },
    },
    async ({ skills, interests, capital_band, avoided_sectors }) => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const gate = can({ id: auth.userId! }, 'personalize');
      if (!gate.ok) {
        return respond(
          { ok: false, error: gate.reason ?? 'Personalization requires Builder.' },
          {
            summary: gate.reason ?? 'Personalization requires Builder.',
            economy: withUserEconomy(auth.userId, 'read'),
            next: [{ tool: 'get_session', arguments: {}, reason: 'thin session memory works on any authenticated tier' }],
          },
        );
      }
      const profile = setProfile(auth.userId!, {
        skills,
        interests,
        capitalBand: capital_band,
        avoidedSectors: avoided_sectors,
      });
      return respond(
        {
          ok: true,
          profile: {
            skills: profile.skills,
            interests: profile.interests,
            capital_band: profile.capitalBand,
            avoided_sectors: profile.avoidedSectors,
            updated_at: profile.updatedAt,
          },
        },
        {
          summary: `Profile saved (${profile.skills.length} skills, ${profile.interests.length} interests).`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [
            { tool: 'get_opportunities', arguments: { limit: 10 }, reason: 'see openings reranked by fit' },
            { tool: 'scout_opportunities', arguments: {}, reason: 'scout openings seeded from your profile' },
          ],
        },
      );
    },
  );

  server.registerTool(
    'get_session',
    {
      description:
        'Read thin agent session memory (last project, last opportunity, watch topics). Any authenticated user.',
      inputSchema: {},
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        session: z
          .object({
            last_project: z.string().nullable(),
            last_opportunity: z.string().nullable(),
            watch_topics: z.array(z.string()),
            updated_at: z.string(),
          })
          .nullable()
          .optional(),
      },
    },
    async () => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const session = getSession(auth.userId!);
      return respond(
        {
          ok: true,
          session: session
            ? {
                last_project: session.lastProject,
                last_opportunity: session.lastOpportunity,
                watch_topics: session.watchTopics,
                updated_at: session.updatedAt,
              }
            : null,
        },
        {
          summary: session
            ? `Session: project=${session.lastProject ?? '—'}, opportunity=${session.lastOpportunity ?? '—'}.`
            : 'No session memory yet.',
          economy: withUserEconomy(auth.userId, 'read'),
        },
      );
    },
  );

  server.registerTool(
    'set_session',
    {
      description:
        'Update thin agent session memory — last project/opportunity/watch topics so ask_radar and get_opportunities can filter without you repeating yourself. Any authenticated user.',
      inputSchema: {
        last_project: z.string().max(400).nullable().optional(),
        last_opportunity: z.string().max(120).nullable().optional(),
        watch_topics: z.array(z.string().min(1).max(60)).max(20).optional(),
      },
      outputSchema: {
        ...envelopeSchema,
        ok: z.boolean(),
        error: z.string().optional(),
        session: z
          .object({
            last_project: z.string().nullable(),
            last_opportunity: z.string().nullable(),
            watch_topics: z.array(z.string()),
            updated_at: z.string(),
          })
          .optional(),
      },
    },
    async ({ last_project, last_opportunity, watch_topics }) => {
      const denied = needAuth(auth);
      if (denied) return denied;
      const session = setSession(auth.userId!, {
        lastProject: last_project,
        lastOpportunity: last_opportunity,
        watchTopics: watch_topics,
      });
      return respond(
        {
          ok: true,
          session: {
            last_project: session.lastProject,
            last_opportunity: session.lastOpportunity,
            watch_topics: session.watchTopics,
            updated_at: session.updatedAt,
          },
        },
        {
          summary: `Session saved (project=${session.lastProject ?? '—'}).`,
          economy: withUserEconomy(auth.userId, 'read'),
          next: [{ tool: 'whats_relevant', arguments: { project: session.lastProject ?? 'ai tools' }, reason: 'pull relevant intel for your last project' }],
        },
      );
    },
  );
}
