/**
 * End-to-end UI validation (Playwright, headless Chromium) — the final gate of
 * the ultrareview remediation. Asserts every user-facing fix landed:
 *
 *  1. Core pages render with ZERO console errors
 *  2. signup → login → logout really kills the session (no resurrection)
 *  3. ?next=/\evil.com and /%5Cevil.com can't open-redirect after login
 *  4. the verdict editor is admin-only (hidden for members, shown for admins)
 *  5. private batches 404 for other users; weekly drops show only a teaser
 *  6. anonymous visitors see no free-text debate cards
 *  7. no javascript: hrefs anywhere on the Today page
 *  8. /app sends X-Frame-Options SAMEORIGIN; /embed/* stays frameable
 *  9. the command palette opens without Radix DialogTitle warnings
 * 10. /app/entity/%25 never 500s
 * 11. screenshots of every visited page in .hfcache/e2e/
 *
 * Prereqs: `npm run build` done; prod server on :3000 with DATABASE_PATH set to
 * the e2e copy; fixtures seeded (.hfcache/e2e-fixtures.ts); e2eadmin admin.
 * Usage: npx tsx scripts/e2e-ui.ts
 */
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright-core';
import fs from 'node:fs';

const WEB = 'http://localhost:3000';
const CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  process.env.LOCALAPPDATA + '\\ms-playwright\\chromium_headless_shell-1208\\chrome-headless-shell-win64\\chrome-headless-shell.exe';
const ADMIN_NAME = 'e2eadmin';
const ADMIN_PASS = process.env.SEED_ADMIN_PASSWORD ?? 'E2e!Admin123';
const SHOTS = '.hfcache/e2e';
const MEMBER_EMAIL = `e2e-member-${Date.now()}@example.com`;
const MEMBER_PASS = 'E2e!Member123';

let passed = 0;
const failures: string[] = [];
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(label);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const consoleErrors = new Map<string, string[]>();
const failedUrls = new Map<string, string[]>();
function watchConsole(page: Page, tag: string): void {
  const log = consoleErrors.get(tag) ?? [];
  consoleErrors.set(tag, log);
  const urls = failedUrls.get(tag) ?? [];
  failedUrls.set(tag, urls);
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') log.push(msg.text());
  });
  page.on('pageerror', (err) => log.push(String(err)));
  page.on('response', (res) => {
    if (res.status() >= 400) urls.push(`${res.status()} ${res.url()}`);
  });
}

/** Benign noise: the login form probes better-auth first and falls back to the
 *  legacy route for name-based accounts — that expected 400 is not an error. */
function isBenign(tag: string, msg: string): boolean {
  if (/favicon|net::ERR_ABORTED|Download the React DevTools/i.test(msg)) return true;
  if (/Failed to load resource: the server responded with a status of 400/.test(msg)) {
    const urls = failedUrls.get(tag) ?? [];
    return urls.length > 0 && urls.every((u) => u.includes('/api/auth/sign-in/email'));
  }
  return false;
}

async function shot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function loginAs(page: Page, nameOrEmail: string, password: string): Promise<void> {
  await page.goto(`${WEB}/login`, { waitUntil: 'load' });
  await page.fill('#email', nameOrEmail);
  await page.fill('#password', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });
}

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch({ executablePath: CHROMIUM });

  // ---------- 1. public + app pages render without console errors ----------
  console.log('\n[1] pages render without console errors');
  const publicPages: [string, string][] = [
    ['home', '/'],
    ['login', '/login'],
    ['signup', '/signup'],
    ['changelog', '/changelog'],
    ['embed-board', '/embed/board'],
  ];
  for (const [name, path] of publicPages) {
    const page = await browser.newPage();
    watchConsole(page, name);
    const res = await page.goto(`${WEB}${path}`, { waitUntil: 'load' });
    check(`GET ${path} → 200`, res?.status() === 200, String(res?.status()));
    await shot(page, `01-${name}`);
    await page.close();
  }

  // ---------- 2. signup → logout → session is really dead ----------
  console.log('\n[2] signup/login/logout lifecycle');
  const member = await browser.newPage();
  watchConsole(member, 'member');
  await member.goto(`${WEB}/signup`, { waitUntil: 'load' });
  await member.fill('#email', MEMBER_EMAIL);
  await member.fill('#password', MEMBER_PASS);
  const nameInput = await member.$('#name');
  if (nameInput) await nameInput.fill('E2E Member');
  await member.check('#agree');
  await member.click('button[type="submit"]');
  await member.waitForURL((url) => !url.pathname.startsWith('/signup'), { timeout: 10_000 });
  check('signup redirects into the app', !member.url().includes('/signup'), member.url());

  // logout via the exit button, then prove the session is gone
  await member.goto(`${WEB}/app`, { waitUntil: 'load' });
  const exitBtn = member.locator('button', { hasText: 'exit' }).first();
  check('logout button present when signed in', (await exitBtn.count()) > 0);
  if ((await exitBtn.count()) > 0) {
    await exitBtn.click();
    await member.waitForURL('**/login**', { timeout: 10_000 });
    await member.goto(`${WEB}/app/account`, { waitUntil: 'load' });
    check(
      'after logout, /app/account does NOT resurrect the session',
      member.url().includes('/login') || (await member.locator('text=Sign in').count()) > 0,
      member.url(),
    );
  }
  await shot(member, '02-after-logout');

  // ---------- 3. open-redirect attempts land in-app ----------
  console.log('\n[3] safeNextPath rejects backslash variants');
  for (const evil of ['/\\evil.com', '/%5Cevil.com']) {
    const res = await member.goto(`${WEB}/login?next=${encodeURIComponent(evil)}`, { waitUntil: 'load' });
    check(`GET /login?next=${evil} → 200`, res?.status() === 200);
  }
  // real login attempt with the backslash next — must end up same-origin
  await member.goto(`${WEB}/login?next=${encodeURIComponent('/\\evil.com')}`, { waitUntil: 'load' });
  await member.fill('#email', MEMBER_EMAIL);
  await member.fill('#password', MEMBER_PASS);
  await member.click('button[type="submit"]');
  await member.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 10_000 });
  check(
    'post-login navigation stays on origin despite ?next=/\\evil.com',
    new URL(member.url()).origin === WEB,
    member.url(),
  );

  // ---------- 4. verdict editor is admin-only ----------
  console.log('\n[4] verdict editor admin gate');
  await member.goto(`${WEB}/app/decide/tools`, { waitUntil: 'load' });
  const memberCanEdit = await member.locator('button:has-text("edit"), [aria-label*="verdict" i] textarea, form:has(textarea)').count();
  check('member sees no verdict editor on /app/decide/tools', memberCanEdit === 0);
  await shot(member, '04-member-decide-tools');

  // ---------- 5. batch object-level authorization ----------
  console.log('\n[5] batch authz');
  const privRes = await member.goto(`${WEB}/app/build/batches/e2e-private-ideas`, { waitUntil: 'load' });
  const privBody = await member.content();
  check(
    'member gets 404 on another user’s private batch',
    privRes?.status() === 404 || privBody.includes('404'),
    String(privRes?.status()),
  );
  check('private idea text never rendered', !privBody.includes('SECRET-E2E-IDEA'));
  await member.close();

  const anon = await browser.newPage();
  watchConsole(anon, 'anon');
  const dropRes = await anon.goto(`${WEB}/app/build/batches/radar-2099-w01`, { waitUntil: 'load' });
  const dropBody = await anon.content();
  check('anonymous drop view returns 200 teaser', dropRes?.status() === 200, String(dropRes?.status()));
  check(
    'anonymous drop view is a teaser, not the full list',
    dropBody.includes('drop item one') && !dropBody.includes('drop item four'),
  );
  check('teaser offers the members upgrade wall', /members|sign in/i.test(dropBody));
  await shot(anon, '05-anon-drop-teaser');

  // ---------- 6. anonymous debates hide free-text cards ----------
  console.log('\n[6] debates privacy');
  await anon.goto(`${WEB}/app/build/debates`, { waitUntil: 'load' });
  const debatesBody = await anon.content();
  check('anonymous debates page shows no free-text cards', !debatesBody.includes('SECRET-E2E-DEBATE'));
  await shot(anon, '06-anon-debates');

  // ---------- 7. no javascript: hrefs on /app ----------
  console.log('\n[7] launches XSS invariant');
  await anon.goto(`${WEB}/app`, { waitUntil: 'load' });
  const jsHrefs = await anon.$$eval('a[href^="javascript:"]', (els) => els.length);
  check('zero javascript: hrefs on /app', jsHrefs === 0);
  await shot(anon, '07-app-today');

  // ---------- 8. framing headers ----------
  console.log('\n[8] security headers');
  const appRes = await anon.goto(`${WEB}/app`, { waitUntil: 'domcontentloaded' });
  check('/app sends x-frame-options SAMEORIGIN', appRes?.headers()['x-frame-options'] === 'SAMEORIGIN', appRes?.headers()['x-frame-options'] ?? 'missing');
  check('/app sends x-content-type-options nosniff', appRes?.headers()['x-content-type-options'] === 'nosniff');
  const embedRes = await anon.goto(`${WEB}/embed/board`, { waitUntil: 'domcontentloaded' });
  check('/embed/board stays frameable (no XFO)', embedRes?.headers()['x-frame-options'] === undefined, embedRes?.headers()['x-frame-options'] ?? 'present');

  // ---------- 9. command palette without Radix warnings ----------
  console.log('\n[9] command palette');
  await anon.goto(`${WEB}/app`, { waitUntil: 'load' });
  const radixWarnings: string[] = [];
  anon.on('console', (msg) => {
    if (/DialogTitle|Missing.*[Tt]itle/i.test(msg.text())) radixWarnings.push(msg.text());
  });
  await anon.keyboard.press('Control+k');
  await anon.waitForTimeout(800);
  const paletteOpen = (await anon.locator('[cmdk-root], [role="dialog"]').count()) > 0;
  check('Ctrl+K opens the command palette', paletteOpen);
  check('no DialogTitle warnings from the palette', radixWarnings.length === 0, radixWarnings[0] ?? '');
  await shot(anon, '09-command-palette');
  await anon.keyboard.press('Escape');

  // ---------- 10. /app/entity/%25 never 500s ----------
  console.log('\n[10] entity route param');
  const entRes = await anon.goto(`${WEB}/app/entity/%25`, { waitUntil: 'load' });
  check('/app/entity/%25 is not a 500', entRes?.status() !== 500, String(entRes?.status()));
  await anon.close();

  // ---------- remaining app pages as the signed-in member + admin ----------
  console.log('\n[11] authenticated pages render');
  const member2 = await browser.newPage();
  watchConsole(member2, 'member2');
  await loginAs(member2, MEMBER_EMAIL, MEMBER_PASS);
  const appPages: [string, string][] = [
    ['app-today', '/app'],
    ['app-map', '/app/map'],
    ['app-search', '/app/search'],
    ['app-domain', '/app/domain/coding'],
    ['app-entity', '/app/entity/vla'],
    ['app-decide-tools', '/app/decide/tools'],
    ['app-decide-stacks', '/app/decide/stacks'],
    ['app-batches', '/app/build/batches'],
    ['app-debates', '/app/build/debates'],
    ['app-account', '/app/account'],
  ];
  for (const [name, path] of appPages) {
    const res = await member2.goto(`${WEB}${path}`, { waitUntil: 'load' });
    check(`GET ${path} → 200 (member)`, res?.status() === 200, String(res?.status()));
    await shot(member2, `11-${name}`);
  }
  // member: other user's private batch still 404
  const priv2 = await member2.goto(`${WEB}/app/build/batches/e2e-private-ideas`, { waitUntil: 'load' });
  check('member keeps 404 on private batch', priv2?.status() === 404 || (await member2.content()).includes('404'));
  await member2.close();

  // admin session via the legacy login
  const admin = await browser.newPage();
  watchConsole(admin, 'admin');
  await loginAs(admin, ADMIN_NAME, ADMIN_PASS);
  await admin.goto(`${WEB}/app/decide/tools`, { waitUntil: 'load' });
  const adminCanEdit = await admin.locator('button:has-text("edit"), textarea').count();
  check('admin sees the verdict editor', adminCanEdit > 0);
  await shot(admin, '12-admin-decide-tools');
  const ownBatch = await admin.goto(`${WEB}/app/build/batches/e2e-private-ideas`, { waitUntil: 'load' });
  check('admin reads their own private batch', ownBatch?.status() === 200, String(ownBatch?.status()));
  check('own batch shows the idea text', (await admin.content()).includes('SECRET-E2E-IDEA'));
  await shot(admin, '12-admin-own-batch');
  await admin.close();

  // ---------- console error sweep ----------
  console.log('\n[console] error sweep across watched pages');
  for (const [tag, errs] of consoleErrors) {
    const real = errs.filter((e) => !isBenign(tag, e));
    check(`zero console errors on ${tag}`, real.length === 0, real[0] ?? '');
  }

  await browser.close();

  console.log(`\n${passed} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const f of failures) console.log(`  FAIL ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
