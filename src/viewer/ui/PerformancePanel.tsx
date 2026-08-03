import type { LoadMode } from '../types';
import { useViewerStore } from '../store/viewerStore';

const modes: LoadMode[] = ['full', 'optimized'];

// ViewerStore에 쌓인 런타임 지표를 화면에 표시합니다.
// renderer.info 기반 값(draw calls, triangles)은 브라우저에서 직접 얻는 값이고,
// loadedBytes는 manifest의 estimatedBytes를 더한 추정 로드 용량입니다.
export function PerformancePanel() {
  const snapshot = useViewerStore((state) => state.snapshot);
  const comparison = useViewerStore((state) => state.comparison);
  const tileRows = useViewerStore((state) => state.tileRows);

  return (
    <div className="mt-4 space-y-4 lg:mt-5 lg:space-y-5">
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
          {/* WebGL 표준 API만으로는 GPU memory를 정확히 알 수 없으므로 숫자로 꾸며내지 않습니다. */}
          <Metric label="GPU Memory" value="측정 불가" />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-100">모드 비교</h2>
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="min-w-[330px] w-full border-collapse text-left text-xs">
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
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="min-w-[300px] w-full border-collapse text-left text-xs">
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
    <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-2 lg:px-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-100 lg:text-base">
        {value}
      </div>
    </div>
  );
}

function modeLabel(mode: LoadMode): string {
  return mode === 'full' ? '전체' : '최적화';
}

// 성능 표에서는 큰 triangle 숫자를 압축해서 패널 폭 안에 들어오게 합니다.
function compactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }

  return value.toString();
}

// 이 값은 실제 GPU 메모리가 아니라 manifest에 적힌 파일 크기 합산입니다.
function formatBytes(bytes: number): string {
  if (bytes <= 0) {
    return '0 MB';
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
