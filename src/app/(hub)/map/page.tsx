import { requireViewer } from '@/lib/auth/user';
import { topicHierarchy } from '@/lib/analytics';
import BubbleMap from '@/components/BubbleMap';

export default async function MapPage() {
  await requireViewer();
  const data = topicHierarchy();

  return (
    <div className="mx-auto max-w-[1100px] px-6 py-7">
      <div className="readout">topic map &middot; categories &rarr; subtopics &rarr; the stories themselves</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Map</h1>

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
