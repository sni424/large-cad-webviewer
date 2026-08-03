import { useEffect, useState } from 'react';
import { demoManifest } from './data/demoManifest';
import { useViewerStore } from './store/viewerStore';
import { SingleGlbViewer } from './SingleGlbViewer';
import { PerformancePanel } from './ui/PerformancePanel';
import { ViewerCanvas } from './ViewerCanvas';
import type { CadManifest } from './types';

type DemoView = 'demo' | 'cargo' | 'glb';

// Viewer 전체 화면을 구성하는 최상위 컴포넌트입니다.
// 왼쪽 패널은 시연용 컨트롤/성능표를 담당하고,
// 오른쪽 영역은 선택한 데이터 모드에 따라 타일 뷰어 또는 단일 GLB 뷰어를 보여줍니다.
export function CadViewer() {
  // demo: 코드로 만든 가짜 대용량 CAD 장면
  // cargo: STEP에서 변환한 실제 Cargo ship split GLB 타일
  // glb: 타일링하지 않은 단일 cargo-ship.glb
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
        // Cargo 탭은 public/manifests의 manifest를 읽어서 타일 목록을 구성합니다.
        // 나중에 백엔드가 생기면 이 URL만 서버 API로 바꾸면 됩니다.
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

  // GLB 단일 보기에서는 manifest가 필요 없습니다.
  // demo/cargo는 둘 다 같은 TileManager 구조를 타기 때문에 manifest만 갈아끼웁니다.
  const activeManifest = view === 'cargo' && cargoManifest ? cargoManifest : demoManifest;
  const isTileMode = view !== 'glb';

  return (
    <div className="flex h-[100dvh] min-h-[560px] flex-col bg-slate-950 text-slate-100 lg:grid lg:h-screen lg:min-h-[640px] lg:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="max-h-[46dvh] min-h-0 shrink-0 overflow-y-auto border-b border-slate-800 bg-slate-900 px-4 py-3 lg:max-h-none lg:border-b-0 lg:border-r lg:px-5 lg:py-4">
        <div className="mb-3 lg:mb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-cyan-300">
            Large CAD Web Viewer PoC
          </p>
          <h1 className="mt-1 text-lg font-semibold text-slate-50 lg:text-xl">
            Tile LOD Loading Compare
          </h1>
          <p className="mt-1 text-xs leading-5 text-slate-400 lg:mt-2 lg:text-sm lg:leading-6">
            전체 로딩과 카메라 기반 타일/LOD 로딩의 차이를 비교합니다.
          </p>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2 lg:mb-4">
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

      <main className="relative min-h-0 min-w-0 flex-1">
        {/* 타일 모드는 LOD/queue/unload 검증용, 단일 GLB 모드는 비교 기준용입니다. */}
        {isTileMode ? (
          <ViewerCanvas manifest={activeManifest} mode={mode} />
        ) : (
          <SingleGlbViewer url="/models/cargo-ship.glb" />
        )}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-slate-700 bg-slate-950/75 px-3 py-2 text-xs text-slate-300 shadow-xl backdrop-blur lg:inset-x-auto lg:bottom-4 lg:left-4">
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

// 현재 선택된 버튼만 cyan으로 강조합니다.
// 시연 UI라서 별도 디자인 시스템 없이 간단한 Tailwind class 조합으로 처리합니다.
function modeButtonClass(active: boolean): string {
  return [
    'min-w-0 rounded-md border px-2 py-2 text-xs font-medium transition sm:text-sm lg:px-3',
    active
      ? 'border-cyan-400 bg-cyan-500 text-slate-950'
      : 'border-slate-700 bg-slate-800 text-slate-100 hover:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-45',
  ].join(' ');
}
