import Link from 'next/link';
import { getIdentity } from '@/lib/identity';
import { paths } from '@/lib/urls';
import ThemeToggle from '@/components/ThemeToggle';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  const name = getIdentity().productName;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-grat bg-[var(--header-bg)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-4 px-4 sm:px-6">
          <Logo href={paths.home} size="md" />
          <nav className="mono ml-4 hidden items-center gap-4 text-[11px] uppercase tracking-[0.1em] text-ink-3 md:flex">
            <Link href={paths.mcp} className="hover:text-ink-2">
              MCP
            </Link>
            <Link href={paths.pricing} className="hover:text-ink-2">
              Pricing
            </Link>
            <Link href={paths.trust} className="hover:text-ink-2">
              Trust
            </Link>
            <Link href={paths.reports} className="hover:text-ink-2">
              Reports
            </Link>
            <Link href={paths.changelog} className="hover:text-ink-2">
              Changelog
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild variant="ghost" size="sm">
              <Link href={paths.login}>Sign in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={paths.app}>Open app</Link>
            </Button>
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="mt-20 border-t border-grat">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <div className="mono text-[11px] font-semibold tracking-[0.16em]">{name.toUpperCase()}</div>
            <p className="mt-1 max-w-md text-[12.5px] text-ink-3">
              Intelligence for people building with AI — what changed, what to use, what to build. MCP-ready.
            </p>
          </div>
          <div className="mono flex flex-wrap gap-4 text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
            <Link href={paths.mcp} className="hover:text-ink-2">
              Connect
            </Link>
            <Link href={paths.pricing} className="hover:text-ink-2">
              Pricing
            </Link>
            <Link href={paths.trust} className="hover:text-ink-2">
              Trust
            </Link>
            <a
              href="https://github.com/RuneLabsOrganization/runelabs-radar"
              className="hover:text-ink-2"
              rel="noreferrer"
            >
              Self-host
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
