'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command';

const QUICK = [
  { label: 'Today / Signal', href: paths.signal, group: 'Workspaces' },
  { label: 'Daily Brief', href: paths.brief, group: 'Workspaces' },
  { label: 'Topic Map', href: paths.map, group: 'Workspaces' },
  { label: 'Best Tools', href: paths.tools, group: 'Decide' },
  { label: 'Stacks', href: paths.stacks, group: 'Decide' },
  { label: 'Agents', href: paths.agents, group: 'Decide' },
  { label: 'Metrics', href: paths.metrics, group: 'Decide' },
  { label: 'Opportunities', href: paths.opportunities, group: 'Build' },
  { label: 'Batches', href: paths.batches, group: 'Build' },
  { label: 'Debates', href: paths.debates, group: 'Build' },
  { label: 'Connect MCP', href: paths.connect, group: 'Connect' },
  { label: 'Pricing', href: paths.pricing, group: 'Site' },
  { label: 'Trust', href: paths.trust, group: 'Site' },
  { label: 'Account', href: paths.account, group: 'Site' },
];

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const router = useRouter();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    if (href === paths.search && query.trim()) {
      router.push(`${paths.search}?q=${encodeURIComponent(query.trim())}`);
    } else {
      router.push(href);
    }
  };

  const groups = Array.from(new Set(QUICK.map((q) => q.group)));

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="hidden gap-1.5 text-ink-3 sm:inline-flex"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="mono text-[10px] uppercase tracking-[0.08em]">Search</span>
        <CommandShortcut className="hidden md:inline">⌘K</CommandShortcut>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Jump to a page, or search stories…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matches. Press Enter to search stories.</CommandEmpty>
          {query.trim() && (
            <CommandGroup heading="Search">
              <CommandItem onSelect={() => go(paths.search)}>
                Search stories for “{query.trim()}”
              </CommandItem>
            </CommandGroup>
          )}
          {groups.map((g) => (
            <CommandGroup key={g} heading={g}>
              {QUICK.filter((q) => q.group === g).map((q) => (
                <CommandItem key={q.href} onSelect={() => go(q.href)}>
                  {q.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
