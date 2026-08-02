import { demoManifest } from './data/demoManifest';
import { useViewerStore } from './store/viewerStore';
import { PerformancePanel } from './ui/PerformancePanel';
import { ViewerCanvas } from './ViewerCanvas';

export function CadViewer() {
  const mode = useViewerStore((state) => state.mode);
  const setMode = useViewerStore((state) => state.setMode);
  const resetComparison = useViewerStore((state) => state.resetComparison);

  return (
    <div className="grid h-screen min-h-[640px] grid-cols-[380px_minmax(0,1fr)] bg-slate-950 text-slate-100">
      <aside className="min-h-0 overflow-y-auto border-r border-slate-800 bg-slate-900 px-5 py-4">
        <div className="mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-cyan-300">
            Large CAD Web Viewer PoC
          </p>
          <h1 className="mt-1 text-xl font-semibold text-slate-50">Tile LOD Loading Compare</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            전체 로딩과 카메라 기반 타일/LOD 로딩의 차이를 비교합니다.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={modeButtonClass(mode === 'full')}
            onClick={() => setMode('full')}
          >
            전체 로딩
          </button>
          <button
            type="button"
            className={modeButtonClass(mode === 'optimized')}
            onClick={() => setMode('optimized')}
          >
            최적화 로딩
          </button>
        </div>

        <button
          type="button"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:border-cyan-400"
          onClick={resetComparison}
        >
          비교 결과 초기화
        </button>

        <PerformancePanel />
      </aside>

      <main className="relative min-h-0 min-w-0">
        <ViewerCanvas manifest={demoManifest} mode={mode} />
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-slate-700 bg-slate-950/75 px-3 py-2 text-xs text-slate-300 shadow-xl backdrop-blur">
          마우스 회전 / 휠 줌 / 우클릭 이동으로 카메라를 움직여 LOD 변화를 확인하세요.
        </div>
      </main>
    </div>
  );
}

function modeButtonClass(active: boolean): string {
  return [
    'rounded-md border px-3 py-2 text-sm font-medium transition',
    active
      ? 'border-cyan-400 bg-cyan-500 text-slate-950'
      : 'border-slate-700 bg-slate-800 text-slate-100 hover:border-cyan-400',
  ].join(' ');
}
