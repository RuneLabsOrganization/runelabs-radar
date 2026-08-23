import Link from 'next/link';
import { MessageSquare, Package, Sparkles, Target } from 'lucide-react';
import { paths } from '@/lib/urls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { WorkspaceNav } from '@/components/app/WorkspaceNav';

export const metadata = {
  title: 'Build',
  description: 'Opportunities, debates, and batches — what to build next.',
};

const LINKS = [
  { href: paths.opportunities, title: 'Opportunities', desc: 'Monetizable openings scored flip/hold with dossiers.', icon: Target },
  { href: paths.batches, title: 'Batches', desc: 'Working sets and weekly Radar drops — debate and plan in bulk.', icon: Package },
  { href: paths.debates, title: 'Debates', desc: 'Advocate · Skeptic · Realist · Judge transcripts.', icon: MessageSquare },
] as const;

export default function BuildPage() {
  return (
    <div>
      <WorkspaceNav section="build" />
      <div className="readout flex items-center gap-2 text-phosphor">
        <Sparkles className="h-3.5 w-3.5" />
        Workspace · What to build
      </div>
      <h1 className="type-h1 mt-1">Build</h1>
      <p className="mt-2 max-w-xl text-[13.5px] text-ink-3">
        What to build — from detected openings to execution plans your agent can run.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
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
