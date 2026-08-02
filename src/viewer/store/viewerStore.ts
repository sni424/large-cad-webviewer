import { create } from 'zustand';
import type { ComparisonResult, LoadMode, PerformanceSnapshot, TileState } from '../types';

// UI 표에 보여주기 좋은 형태로 정리한 타일 상태입니다.
// Three.js 객체는 여기에 넣지 않습니다.
export interface TileStatusRow {
  id: string;
  state: TileState;
  lod: string;
  distance: number;
  loadedBytes: number;
}

// Viewer 전체 UI 상태입니다.
// 실제 로딩/해제 로직은 TileManager가 담당하고,
// Zustand는 버튼/패널/표가 읽기 좋은 데이터만 저장합니다.
interface ViewerStoreState {
  mode: LoadMode;
  selectedTileId: string | null;
  snapshot: PerformanceSnapshot | null;
  comparison: Partial<Record<LoadMode, ComparisonResult>>;
  tileRows: TileStatusRow[];

  setMode: (mode: LoadMode) => void;
  setSelectedTileId: (tileId: string | null) => void;
  setSnapshot: (snapshot: PerformanceSnapshot) => void;
  setTileRows: (rows: TileStatusRow[]) => void;
  resetComparison: () => void;
}

export const useViewerStore = create<ViewerStoreState>((set) => ({
  mode: 'optimized',
  selectedTileId: null,
  snapshot: null,
  comparison: {},
  tileRows: [],

  setMode: (mode) => set({ mode }),

  setSelectedTileId: (selectedTileId) => set({ selectedTileId }),

  // 성능 측정값을 저장하면서, 현재 모드의 비교 결과도 같이 갱신합니다.
  setSnapshot: (snapshot) =>
    set((state) => ({
      snapshot,
      comparison: {
        ...state.comparison,
        [snapshot.mode]: {
          mode: snapshot.mode,
          initialDisplayMs: snapshot.initialDisplayMs,
          fps: snapshot.fps,
          drawCalls: snapshot.drawCalls,
          triangles: snapshot.triangles,
          activeTiles: snapshot.loadedTiles,
          loadedBytes: snapshot.loadedBytes,
        },
      },
    })),

  setTileRows: (tileRows) => set({ tileRows }),

  // 새 시연을 시작하거나 manifest를 바꿀 때 비교 표를 초기화합니다.
  resetComparison: () => set({ comparison: {} }),
}));
