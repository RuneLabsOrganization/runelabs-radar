import { requireViewer } from '@/lib/auth/user';
import { topicHierarchy, topicHierarchyAsOf } from '@/lib/analytics';
import { WINDOW_DAYS } from '@/lib/science/cluster';
import BubbleMap from '@/components/BubbleMap';
import PageHeader from '@/components/PageHeader';
import { WorkspaceNav } from '@/components/app/WorkspaceNav';

export default async function MapPage() {
  await requireViewer();
  const data = topicHierarchy();
  const asOf = data && data.length > 0 ? topicHierarchyAsOf() : null;

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-7">
      <WorkspaceNav section="signal" />
      <PageHeader
        kicker="topic map · categories → subtopics → stories"
        title="Topic Map"
        description="Every recent story clustered by topic — bigger bubbles got more coverage."
      />

      {asOf && (
        <p className="mono mt-2 text-[11px] text-ink-4">
          as-of {asOf} · stories from the last {WINDOW_DAYS} days
        </p>
      )}

      {!data || data.length === 0 ? (
        <p className="mono mt-8 text-[12px] text-ink-4">
          The map forms once the daily science run has clustered enough embedded stories.
        </p>
      ) : (
        <div className="mt-5">
          <p className="mono mb-2 text-[10px] text-ink-4">
            heat = recent story activity vs other topics at the same level
          </p>
          <BubbleMap data={data} />
        </div>
      )}
    </div>
  );
}
