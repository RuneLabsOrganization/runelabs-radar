/**
 * The navigation model, shared by both shells.
 *
 * Every header, sheet and tab strip reads from here so labels and active-state
 * rules cannot drift apart the way three hand-maintained copies did.
 */
import { paths } from './urls';

export interface NavTab {
  href: string;
  label: string;
  /** defaults to exact match or a path segment below `href` */
  match?: (pathname: string) => boolean;
}

export interface Workspace {
  id: 'signal' | 'decide' | 'build' | 'connect' | 'admin';
  href: string;
  label: string;
  /** one-liner used in the mobile sheet */
  hint: string;
  adminOnly?: boolean;
  match: (pathname: string) => boolean;
  tabs: NavTab[];
}

const under = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`);

/** Signal detail routes live at the top of /app rather than under /app/signal. */
const SIGNAL_DETAIL = ['/app/domain/', '/app/story/', '/app/entity/'];
const isSignalDetail = (p: string) => SIGNAL_DETAIL.some((prefix) => p.startsWith(prefix));

export const WORKSPACES: Workspace[] = [
  {
    id: 'signal',
    href: paths.signal,
    label: 'Signal',
    hint: 'What changed',
    match: (p) =>
      p === paths.signal || isSignalDetail(p) || under(paths.brief)(p) || under(paths.map)(p) || under(paths.search)(p),
    tabs: [
      { href: paths.signal, label: 'Today', match: (p) => p === paths.signal || isSignalDetail(p) },
      { href: paths.brief, label: 'Brief' },
      { href: paths.map, label: 'Topic map' },
      { href: paths.search, label: 'Search' },
    ],
  },
  {
    id: 'decide',
    href: paths.decide,
    label: 'Decide',
    hint: 'What to use',
    match: under(paths.decide),
    tabs: [
      { href: paths.decide, label: 'Overview' },
      { href: paths.tools, label: 'Best tools' },
      { href: paths.stacks, label: 'Stacks' },
      { href: paths.agents, label: 'Agents' },
      { href: paths.metrics, label: 'Pulse' },
    ],
  },
  {
    id: 'build',
    href: paths.build,
    label: 'Build',
    hint: 'What to build',
    match: under(paths.build),
    tabs: [
      { href: paths.build, label: 'Overview' },
      { href: paths.opportunities, label: 'Opportunities' },
      { href: paths.batches, label: 'Batches' },
      { href: paths.debates, label: 'Debates' },
    ],
  },
  {
    id: 'connect',
    href: paths.connect,
    label: 'Connect',
    hint: 'Wire up your agent',
    match: under(paths.connect),
    tabs: [],
  },
  {
    id: 'admin',
    href: paths.admin,
    label: 'Admin',
    hint: 'Pipeline health',
    adminOnly: true,
    match: under(paths.admin),
    tabs: [
      { href: paths.admin, label: 'Overview' },
      { href: paths.adminUsage, label: 'Usage' },
    ],
  },
];

export function workspacesFor(isAdmin: boolean): Workspace[] {
  return WORKSPACES.filter((w) => !w.adminOnly || isAdmin);
}

export function activeWorkspace(pathname: string): Workspace | null {
  return WORKSPACES.find((w) => w.match(pathname)) ?? null;
}

export function tabActive(tab: NavTab, pathname: string): boolean {
  return tab.match ? tab.match(pathname) : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

/** True for anything rendered inside the app shell. */
export function isAppPath(pathname: string): boolean {
  return pathname === paths.app || pathname.startsWith(`${paths.app}/`);
}

/** The public site's primary links — header, mobile sheet and footer. */
export const SITE_LINKS: { href: string; label: string }[] = [
  { href: paths.mcp, label: 'MCP' },
  { href: paths.pricing, label: 'Pricing' },
  { href: paths.trust, label: 'Trust' },
  { href: paths.reports, label: 'Reports' },
  { href: paths.changelog, label: 'Changelog' },
];
