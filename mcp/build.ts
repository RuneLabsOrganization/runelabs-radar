import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthContext } from './lib/auth';
import { registerSignalTools } from './tools/signals';
import { registerLaunchTools } from './tools/launches';
import { registerBoardTools } from './tools/board';
import { registerStackTools } from './tools/stacks';
import { registerAgentStackTools } from './tools/agent-stacks';
import { registerOpportunityTools } from './tools/opportunities';
import { registerLeadTools } from './tools/leads';
import { registerPlanTools } from './tools/plans';
import { registerBriefTools } from './tools/briefs';
import { registerPainTools } from './tools/pains';
import { registerPatternTools } from './tools/patterns';
import { registerMapTools } from './tools/map';
import { registerMarketTools } from './tools/market';
import { registerForecastTools } from './tools/forecasts';
import { registerEntityTools } from './tools/entities';
import { registerCompTools } from './tools/comps';
import { registerMetaTools } from './tools/meta';
import { registerUsageTools } from './tools/usage';
import { registerDebateTools } from './tools/debate';
import { registerScoutTools } from './tools/scout';
import { registerWeeklyTools } from './tools/weekly';
import { registerBatchTools } from './tools/batches';
import { registerAskTools } from './tools/ask';
import { registerJobTools } from './tools/jobs';
import { registerProfileTools } from './tools/profile';
import { registerWatchTools } from './tools/watch';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';

/**
 * One fully-registered MCP server instance. Called per request (stateless
 * transport) by server.ts, and by tests with an in-memory DB. The auth
 * context is baked into the tools that need it (market gating, plan scope).
 */
export function buildServer(auth: AuthContext): McpServer {
  const server = new McpServer({
    name: 'runelabs-radar',
    version: '0.4.0',
  });
  registerSignalTools(server);
  registerLaunchTools(server);
  registerBoardTools(server);
  registerStackTools(server);
  registerAgentStackTools(server);
  registerOpportunityTools(server, auth);
  registerLeadTools(server, auth);
  registerPlanTools(server, auth);
  registerBriefTools(server);
  registerPainTools(server);
  registerPatternTools(server);
  registerMapTools(server);
  registerMarketTools(server, auth);
  registerForecastTools(server);
  registerEntityTools(server);
  registerCompTools(server);
  registerMetaTools(server, auth);
  registerUsageTools(server, auth);
  registerDebateTools(server, auth);
  registerScoutTools(server, auth);
  registerWeeklyTools(server, auth);
  registerBatchTools(server, auth);
  registerAskTools(server, auth);
  registerJobTools(server, auth);
  registerProfileTools(server, auth);
  registerWatchTools(server, auth);
  registerResources(server, auth);
  registerPrompts(server);
  return server;
}
