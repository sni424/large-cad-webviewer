import { useEffect, useState } from 'react';
import { demoManifest } from './data/demoManifest';
import { useViewerStore } from './store/viewerStore';
import { SingleGlbViewer } from './SingleGlbViewer';
import { PerformancePanel } from './ui/PerformancePanel';
import { ViewerCanvas } from './ViewerCanvas';
import type { CadManifest } from './types';

type DemoView = 'demo' | 'cargo' | 'glb';

export function CadViewer() {
  const [view, setView] = useState<DemoView>('demo');
  const [cargoManifest, setCargoManifest] = useState<CadManifest | null>(null);
  const [cargoManifestError, setCargoManifestError] = useState<string | null>(null);
  const mode = useViewerStore((state) => state.mode);
  const setMode = useViewerStore((state) => state.setMode);
  const resetComparison = useViewerStore((state) => state.resetComparison);

  useEffect(() => {
    let cancelled = false;

    async function loadCargoManifest() {
      try {
        const response = await fetch('/manifests/cargo-ship.manifest.json');

        if (!response.ok) {
          throw new Error(`manifest load failed: ${response.status}`);
        }

        const manifest = (await response.json()) as CadManifest;

        if (!cancelled) {
          setCargoManifest(manifest);
          setCargoManifestError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setCargoManifestError(error instanceof Error ? error.message : 'manifest load failed');
        }
      }
    }

    loadCargoManifest();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeManifest = view === 'cargo' && cargoManifest ? cargoManifest : demoManifest;
  const isTileMode = view !== 'glb';

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

        <div className="mb-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            className={modeButtonClass(view === 'demo')}
            onClick={() => setView('demo')}
          >
            데모
          </button>
          <button
            type="button"
            className={modeButtonClass(view === 'cargo')}
            onClick={() => setView('cargo')}
            disabled={!cargoManifest}
          >
            Cargo
          </button>
          <button
            type="button"
            className={modeButtonClass(view === 'glb')}
            onClick={() => setView('glb')}
          >
            실제 GLB
          </button>
        </div>

        {cargoManifestError ? (
          <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
            Cargo manifest 로딩 실패: {cargoManifestError}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={modeButtonClass(mode === 'full')}
            onClick={() => setMode('full')}
            disabled={!isTileMode}
          >
            전체 로딩
          </button>
          <button
            type="button"
            className={modeButtonClass(mode === 'optimized')}
            onClick={() => setMode('optimized')}
            disabled={!isTileMode}
          >
            최적화 로딩
          </button>
        </div>

        <button
          type="button"
          className="mt-2 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-100 hover:border-cyan-400"
          onClick={resetComparison}
          disabled={!isTileMode}
        >
          비교 결과 초기화
        </button>

        <PerformancePanel />
      </aside>

      <main className="relative min-h-0 min-w-0">
        {isTileMode ? (
          <ViewerCanvas manifest={activeManifest} mode={mode} />
        ) : (
          <SingleGlbViewer url="/models/cargo-ship.glb" />
        )}
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-slate-700 bg-slate-950/75 px-3 py-2 text-xs text-slate-300 shadow-xl backdrop-blur">
          {view === 'demo'
            ? '절차적으로 만든 데모 타일입니다. 전체 로딩과 최적화 로딩 차이를 크게 보여줍니다.'
            : view === 'cargo'
              ? 'OCCT로 STEP에서 분할 변환한 33개 Cargo component GLB tile입니다.'
              : 'OCCT로 STEP에서 변환한 단일 cargo-ship.glb 모델입니다.'}
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
      : 'border-slate-700 bg-slate-800 text-slate-100 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-45',
  ].join(' ');
}
