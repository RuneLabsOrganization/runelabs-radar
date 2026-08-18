import { requireViewer } from '@/lib/auth/user';
import { topicHierarchy } from '@/lib/analytics';
import BubbleMap from '@/components/BubbleMap';
import PageHeader from '@/components/PageHeader';

export default async function MapPage() {
  await requireViewer();
  const data = topicHierarchy();

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-7">
      <PageHeader
        kicker="topic map &middot; categories &rarr; subtopics &rarr; the stories themselves"
        title="Topic Map"
        description="Every recent story clustered by topic — bigger bubbles got more coverage."
      />

      {!data || data.length === 0 ? (
        <p className="mono mt-8 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          The map forms once the daily science run has clustered enough embedded stories.
        </p>
      ) : (
        <div className="mt-5">
          <BubbleMap data={data} />
        </div>
      )}
    </div>
  );
}
