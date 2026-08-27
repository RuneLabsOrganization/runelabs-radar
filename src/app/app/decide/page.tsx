import { BarChart3, Bot, Briefcase, Layers, LayoutGrid } from 'lucide-react';
import { paths } from '@/lib/urls';
import { KIT_PERSONAS } from '@/lib/kits/personas';
import { DOMAINS } from '@/lib/domains';
import PageHeader from '@/components/PageHeader';
import SectionHeader from '@/components/SectionHeader';
import { HubCard } from '@/components/app/HubCard';

export const metadata = {
  title: 'Decide',
  description: 'Best tools, stacks, agent playbooks, and market pulse — what to use right now.',
};

export default function DecidePage() {
  return (
    <div>
      <PageHeader
        kicker={
          <span className="flex items-center gap-1.5 text-phosphor">
            <Layers className="h-3 w-3" aria-hidden />
            Workspace · What to use
          </span>
        }
        title="Decide"
        description="Settle it once. What to use for each job, what to build your product on, and what to run your coding agent with — with the reasoning, so you can disagree with us on purpose rather than by accident."
      />

      <SectionHeader label="Answers" count={5} className="mt-6" />
      <div className="grid gap-3 sm:grid-cols-2">
        <HubCard
          href={paths.tools}
          title="Best Tools"
          desc="The cost-benefit board: one ranked answer per domain and task, with the evidence behind each call."
          icon={LayoutGrid}
          meta={`${DOMAINS.length} domains`}
          feature
          className="sm:col-span-2"
        />
        <HubCard
          href={paths.kits}
          title="Kits"
          desc="The whole stack for one role, costed. One pick per job, a monthly total, and honest gaps."
          icon={Briefcase}
          meta={`${KIT_PERSONAS.length} roles`}
        />
        <HubCard
          href={paths.stacks}
          title="Stacks"
          desc="Venture ship-it playbooks by layer — fastest to a working MVP, cheap to run."
          icon={Layers}
        />
        <HubCard
          href={paths.agents}
          title="Agents"
          desc="IDE, harness and model pairings, with what each subscription plan actually buys you."
          icon={Bot}
        />
        <HubCard
          href={paths.metrics}
          title="Pulse"
          desc="What's moving — launch heat, rising adoption, and plan prices as they change."
          icon={BarChart3}
        />
      </div>
    </div>
  );
}
