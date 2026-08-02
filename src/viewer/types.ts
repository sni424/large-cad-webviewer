import type { Object3D } from 'three';

// 로딩 전략입니다.
// full: 모든 타일을 한 번에 로딩
// optimized: 카메라 거리 기준으로 필요한 타일/LOD만 로딩
export type LoadMode = 'full' | 'optimized';

// 한 타일이 가질 수 있는 상세도 단계입니다.
export type LodLevel = 'high' | 'medium' | 'proxy';

// 타일 하나의 현재 생명주기 상태입니다.
// 이 상태를 기준으로 중복 로딩, 중복 dispose를 막습니다.
export type TileState = 'unloaded' | 'queued' | 'loading' | 'loaded' | 'disposing' | 'error';

// Three.js Vector3로 바꾸기 전, manifest에서 쓰기 쉬운 좌표 형식입니다.
export type Vec3Tuple = [number, number, number];

// 타일의 대략적인 공간 범위입니다.
// 나중에 카메라 프레이밍, 선택, culling 최적화에도 활용할 수 있습니다.
export interface TileBounds {
  min: Vec3Tuple;
  max: Vec3Tuple;
}

// LOD별 실제 모델 파일 정보입니다.
// 지금은 procedural:// URL도 허용하고, 나중에는 /models/*.glb로 바꾸면 됩니다.
export interface LodAsset {
  url: string;
  estimatedBytes: number;
}

// manifest에 들어가는 타일 1개의 정적 정보입니다.
// 실제 조선 CAD에서는 블록, 장비, 배관 묶음 하나가 타일이 될 수 있습니다.
export interface TileManifestEntry {
  id: string;
  center: Vec3Tuple;
  radius: number;
  bounds?: TileBounds;
  lods: Record<LodLevel, LodAsset>;
  metadataUrl?: string;
}

// 웹뷰어가 처음 읽는 전체 CAD 데이터 목록입니다.
// 서버 변환 파이프라인이 최종적으로 이 manifest를 만들어주면 됩니다.
export interface CadManifest {
  id: string;
  name: string;
  units: 'm' | 'mm' | 'cm' | string;
  description?: string;
  tiles: TileManifestEntry[];
}

// 앱이 실행되는 동안 TileManager가 관리하는 타일 상태입니다.
// Object3D 같은 Three.js 객체는 Zustand에 넣지 않고 런타임 객체 안에서만 다룹니다.
export interface TileRuntime {
  entry: TileManifestEntry;
  state: TileState;
  activeLod: LodLevel | null;
  desiredLod: LodLevel | null;
  object: Object3D | null;
  loadedBytes: number;
  lastDistance: number;
  requestToken: number;
  error?: string;
}

// LoadQueue에 들어가는 작업 1개입니다.
// priority가 낮을수록 먼저 실행됩니다.
export interface QueueJob {
  key: string;
  tileId: string;
  lod: LodLevel;
  priority: number;
  estimatedBytes: number;
  run: () => Promise<Object3D>;
  onComplete: (object: Object3D) => void;
  onError: (error: unknown) => void;
}

// UI 성능 패널에 보여줄 큐 상태입니다.
export interface QueueStats {
  queued: number;
  loading: number;
  maxConcurrent: number;
}

// 매 프레임 또는 일정 주기마다 UI에 전달할 성능 지표입니다.
// GPU 메모리는 브라우저에서 정확히 알기 어려우므로 여기에도 넣지 않습니다.
export interface PerformanceSnapshot {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  loadedTiles: number;
  totalTiles: number;
  queued: number;
  loading: number;
  loadedBytes: number;
  initialDisplayMs: number | null;
  mode: LoadMode;
}

// full 모드와 optimized 모드의 결과를 비교 표에 저장하기 위한 타입입니다.
export interface ComparisonResult {
  mode: LoadMode;
  initialDisplayMs: number | null;
  fps: number;
  drawCalls: number;
  triangles: number;
  activeTiles: number;
  loadedBytes: number;
}
