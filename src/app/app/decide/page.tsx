import Link from 'next/link';
import { BarChart3, Bot, Layers, LayoutGrid } from 'lucide-react';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WorkspaceNav } from '@/components/app/WorkspaceNav';

export const metadata = {
  title: 'Decide',
  description: 'Best tools, stacks, agent playbooks, and metrics — what to use right now.',
};

const LINKS = [
  { href: paths.tools, title: 'Best Tools', desc: 'Cost-benefit board per domain and task.', icon: LayoutGrid },
  { href: paths.stacks, title: 'Stacks', desc: 'Venture ship-it playbooks by layer.', icon: Layers },
  { href: paths.agents, title: 'Agents', desc: 'IDE + harness + model pairings and subscription plans.', icon: Bot },
  { href: paths.metrics, title: 'Metrics', desc: 'Explore first-party price and capability series.', icon: BarChart3 },
] as const;

export default function DecidePage() {
  return (
    <div>
      <WorkspaceNav section="decide" />
      <div className="readout flex items-center gap-2 text-phosphor">
        <Layers className="h-3.5 w-3.5" />
        Workspace · What to use
      </div>
      <h1 className="type-h1 mt-1">Decide</h1>
      <p className="mt-2 max-w-xl text-[13.5px] text-ink-3">What to use — ranked for builders, grounded in live market data.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {LINKS.map((l) => (
          <Card key={l.href} className="hover-raise">
            <CardHeader>
              <l.icon className="h-4 w-4 text-phosphor" />
              <CardTitle className="mt-2">{l.title}</CardTitle>
              <CardDescription>{l.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline" size="sm">
                <Link href={l.href}>Open</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
