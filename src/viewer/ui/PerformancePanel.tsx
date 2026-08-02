import type { LoadMode } from '../types';
import { useViewerStore } from '../store/viewerStore';

const modes: LoadMode[] = ['full', 'optimized'];

export function PerformancePanel() {
  const snapshot = useViewerStore((state) => state.snapshot);
  const comparison = useViewerStore((state) => state.comparison);
  const tileRows = useViewerStore((state) => state.tileRows);

  return (
    <div className="mt-5 space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">실시간 성능</h2>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="FPS" value={snapshot ? snapshot.fps.toFixed(1) : '-'} />
          <Metric label="Frame" value={snapshot ? `${snapshot.frameTimeMs.toFixed(1)} ms` : '-'} />
          <Metric label="Draw Calls" value={snapshot ? snapshot.drawCalls.toLocaleString() : '-'} />
          <Metric label="Triangles" value={snapshot ? snapshot.triangles.toLocaleString() : '-'} />
          <Metric
            label="Tiles"
            value={snapshot ? `${snapshot.loadedTiles} / ${snapshot.totalTiles}` : '-'}
          />
          <Metric label="Queued" value={snapshot ? snapshot.queued.toString() : '-'} />
          <Metric label="Loading" value={snapshot ? snapshot.loading.toString() : '-'} />
          <Metric label="Loaded Size" value={snapshot ? formatBytes(snapshot.loadedBytes) : '-'} />
          <Metric
            label="Initial Display"
            value={
              snapshot?.initialDisplayMs == null ? '측정 중' : `${snapshot.initialDisplayMs.toFixed(0)} ms`
            }
          />
          <Metric label="GPU Memory" value="측정 불가" />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">모드 비교</h2>
        <div className="overflow-hidden rounded-md border border-slate-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-2 py-2 font-medium">모드</th>
                <th className="px-2 py-2 font-medium">초기</th>
                <th className="px-2 py-2 font-medium">FPS</th>
                <th className="px-2 py-2 font-medium">Draw</th>
                <th className="px-2 py-2 font-medium">Tri</th>
                <th className="px-2 py-2 font-medium">타일</th>
                <th className="px-2 py-2 font-medium">용량</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {modes.map((mode) => {
                const result = comparison[mode];

                if (!result) {
                  return (
                    <tr key={mode}>
                      <td className="px-2 py-2 text-slate-300">{modeLabel(mode)}</td>
                      <td className="px-2 py-2 text-slate-500" colSpan={6}>
                        아직 측정 전
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={mode} className="text-slate-300">
                    <td className="px-2 py-2">{modeLabel(mode)}</td>
                    <td className="px-2 py-2">
                      {result.initialDisplayMs == null ? '-' : `${result.initialDisplayMs.toFixed(0)} ms`}
                    </td>
                    <td className="px-2 py-2">{result.fps.toFixed(1)}</td>
                    <td className="px-2 py-2">{result.drawCalls.toLocaleString()}</td>
                    <td className="px-2 py-2">{compactNumber(result.triangles)}</td>
                    <td className="px-2 py-2">{result.activeTiles}</td>
                    <td className="px-2 py-2">{formatBytes(result.loadedBytes)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">가까운 타일</h2>
        <div className="overflow-hidden rounded-md border border-slate-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-800 text-slate-300">
              <tr>
                <th className="px-2 py-2 font-medium">id</th>
                <th className="px-2 py-2 font-medium">상태</th>
                <th className="px-2 py-2 font-medium">LOD</th>
                <th className="px-2 py-2 font-medium">거리</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tileRows.slice(0, 7).map((tile) => (
                <tr key={tile.id} className="text-slate-300">
                  <td className="px-2 py-2">{tile.id}</td>
                  <td className="px-2 py-2">{tile.state}</td>
                  <td className="px-2 py-2">{tile.lod}</td>
                  <td className="px-2 py-2">{tile.distance.toFixed(0)} m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 break-words text-base font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function modeLabel(mode: LoadMode): string {
  return mode === 'full' ? '전체' : '최적화';
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }

  return value.toString();
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 MB';
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
