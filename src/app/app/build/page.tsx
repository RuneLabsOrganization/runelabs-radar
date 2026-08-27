import { MessageSquare, Package, Sparkles, Target } from 'lucide-react';
import { paths } from '@/lib/urls';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import { HubCard } from '@/components/app/HubCard';

export const metadata = {
  title: 'Build',
  description: 'Opportunities, debates, and batches — what to build next.',
};

export default function BuildPage() {
  return (
    <div>
      <PageHeader
        kicker={
          <span className="flex items-center gap-1.5 text-phosphor">
            <Sparkles className="h-3 w-3" aria-hidden />
            Workspace · What to build
          </span>
        }
        title="Build"
        description="For when you want a new project, not a new tool. Openings where somebody is already complaining about the problem, argued from four sides before you commit a month to one, then written up as a plan your agent can actually run."
      />

      <SectionHeader label="Pipeline" count={3} className="mt-6" />
      <div className="grid gap-3 sm:grid-cols-2">
        <HubCard
          href={paths.opportunities}
          title="Opportunities"
          desc="Monetizable openings scored flip or hold, each with a dossier of the evidence that found it."
          icon={Target}
          meta="start here"
          feature
          className="sm:col-span-2"
        />
        <HubCard
          href={paths.batches}
          title="Batches"
          desc="Working sets and the weekly Radar drop — debate and plan a whole shortlist in bulk."
          icon={Package}
        />
        <HubCard
          href={paths.debates}
          title="Debates"
          desc="Advocate, Skeptic, Realist and Judge — the full transcript behind each verdict."
          icon={MessageSquare}
        />
      </div>
    </div>
  );
}
