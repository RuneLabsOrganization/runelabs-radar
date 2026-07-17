import { requireViewer } from '@/lib/auth/user';
import { topicMapData } from '@/lib/analytics';
import MapExplorer from '@/components/MapExplorer';

export default async function MapPage() {
  await requireViewer();
  const data = topicMapData();

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-7">
      <div className="readout">semantic starfield &middot; every story placed by meaning &middot; depth = time</div>
      <h1 className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">Map</h1>

      {!data || data.points.length < 12 ? (
        <p className="mono mt-8 text-[12px]" style={{ color: 'var(--ink-4)' }}>
          The starfield forms once the daily science run has clustered enough embedded stories.
        </p>
      ) : (
        <div className="mt-5">
          <MapExplorer clusters={data.clusters} points={data.points} />
        </div>
      )}
    </div>
  );
}
