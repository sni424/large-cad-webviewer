import * as THREE from 'three';
import type {
  CadManifest,
  LoadMode,
  LodLevel,
  PerformanceSnapshot,
  TileRuntime,
} from '../types';
import { LoadQueue } from './LoadQueue';
import { LODController } from './LODController';
import { ResourceDisposer } from './ResourceDisposer';
import { ModelLoader } from '../loaders/ModelLoader';

export interface TileStatusDebugRow {
  id: string;
  state: TileRuntime['state'];
  lod: string;
  distance: number;
  loadedBytes: number;
}

// 타일 로딩 전략의 중심 클래스입니다.
// React 컴포넌트는 "버튼/패널"을 담당하고,
// 이 클래스는 "어떤 타일을 scene에 넣고 뺄지"만 담당합니다.
export class TileManager {
  private readonly scene: THREE.Scene;
  private readonly tiles = new Map<string, TileRuntime>();
  private readonly pendingAttachTileIds = new Set<string>();
  private readonly root = new THREE.Group();
  private readonly queue = new LoadQueue(1);
  private readonly lodController = new LODController();
  private readonly modelLoader = new ModelLoader();
  private readonly disposer = new ResourceDisposer();
  private mode: LoadMode = 'optimized';
  private modeStartedAt = performance.now();
  private initialDisplayMs: number | null = null;
  private isNavigating = false;
  private viewportHeight = 1;

  constructor(scene: THREE.Scene, manifest: CadManifest) {
    this.scene = scene;
    this.root.name = 'cad-tile-root';
    this.scene.add(this.root);

    for (const entry of manifest.tiles) {
      this.tiles.set(entry.id, {
        entry,
        state: 'unloaded',
        activeLod: null,
        desiredLod: null,
        object: null,
        loadedBytes: 0,
        lastDistance: Number.POSITIVE_INFINITY,
        lastUsedAt: 0,
        requestToken: 0,
      });
    }
  }

  setMode(mode: LoadMode, camera: THREE.Camera): void {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    this.reset(camera);
  }

  setNavigationState(isNavigating: boolean): void {
    this.isNavigating = isNavigating;
  }

  setViewportHeight(viewportHeight: number): void {
    this.viewportHeight = Math.max(1, viewportHeight);
  }

  // 모드 전환 또는 시연 재시작 때 모든 타일과 큐 상태를 초기화합니다.
  reset(camera: THREE.Camera): void {
    this.queue.clear();
    this.pendingAttachTileIds.clear();

    for (const tile of this.tiles.values()) {
      tile.requestToken += 1;
      this.disposeTile(tile, true);
      tile.state = 'unloaded';
      tile.activeLod = null;
      tile.desiredLod = null;
      tile.loadedBytes = 0;
      tile.error = undefined;
    }

    this.modeStartedAt = performance.now();
    this.initialDisplayMs = null;
    this.update(camera);
  }

  // 매 프레임 또는 카메라 이동 후 호출합니다.
  // full 모드는 모든 타일 high 로딩, optimized 모드는 거리 기준 로딩입니다.
  update(camera: THREE.Camera): void {
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);

    for (const tile of this.tiles.values()) {
      const tileCenter = new THREE.Vector3(
        tile.entry.center[0],
        tile.entry.center[1],
        tile.entry.center[2],
      );
      tile.lastDistance = tileCenter.distanceTo(cameraPosition);

      if (this.mode === 'full') {
        this.ensureTile(tile, 'high', tile.lastDistance);
        continue;
      }

      const desiredLod = this.lodController.getDesiredLod(tile, {
        camera,
        viewportHeight: this.viewportHeight,
      });

      if (desiredLod === null) {
        this.queue.cancel((job) => job.tileId === tile.entry.id);
        tile.desiredLod = null;

        if (tile.object) {
          this.detachTile(tile);
        }

        continue;
      }

      this.ensureTile(tile, desiredLod, tile.lastDistance);
    }

    this.attachReadyTiles();
  }

  // PerformancePanel에 전달할 현재 렌더링 지표입니다.
  createSnapshot(
    renderer: THREE.WebGLRenderer,
    fps: number,
    frameTimeMs: number,
  ): PerformanceSnapshot {
    const queueStats = this.queue.getStats();
    const loadedTiles = [...this.tiles.values()].filter(
      (tile) => tile.object !== null && tile.object.parent === this.root,
    ).length;
    const loadedBytes = [...this.tiles.values()].reduce((sum, tile) => sum + tile.loadedBytes, 0);

    return {
      fps,
      frameTimeMs,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      loadedTiles,
      totalTiles: this.tiles.size,
      queued: queueStats.queued,
      loading: queueStats.loading,
      loadedBytes,
      initialDisplayMs: this.initialDisplayMs,
      mode: this.mode,
    };
  }

  // UI의 타일 상태 표에 보여줄 값을 만듭니다.
  getTileRows(): TileStatusDebugRow[] {
    return [...this.tiles.values()]
      .sort((a, b) => a.lastDistance - b.lastDistance)
      .map((tile) => ({
        id: tile.entry.id,
        state: tile.state,
        lod: tile.activeLod ?? '-',
        distance: tile.lastDistance,
        loadedBytes: tile.loadedBytes,
      }));
  }

  dispose(): void {
    this.queue.clear();

    for (const tile of this.tiles.values()) {
      this.disposeTile(tile, true);
    }

    this.scene.remove(this.root);
  }

  private ensureTile(tile: TileRuntime, lod: LodLevel, distance: number): void {
    if (tile.activeLod === lod && tile.object) {
      tile.desiredLod = lod;
      tile.lastUsedAt = performance.now();

      if (tile.object.parent !== this.root) {
        this.pendingAttachTileIds.add(tile.entry.id);
      }

      return;
    }

    // 이미 같은 LOD를 기다리거나 로딩 중이면 새 작업을 만들지 않습니다.
    if ((tile.state === 'queued' || tile.state === 'loading') && tile.desiredLod === lod) {
      return;
    }

    // 다른 LOD로 바뀌면 아직 시작하지 않은 이전 작업은 취소합니다.
    this.queue.cancel((job) => job.tileId === tile.entry.id);

    const requestToken = tile.requestToken + 1;
    tile.requestToken = requestToken;
    tile.desiredLod = lod;
    tile.state = 'queued';
    tile.error = undefined;

    this.queue.enqueue({
      key: `${tile.entry.id}:${lod}:${requestToken}`,
      tileId: tile.entry.id,
      lod,
      priority: this.lodController.getPriority(tile, distance, lod),
      estimatedBytes: tile.entry.lods[lod].estimatedBytes,
      run: () => {
        tile.state = 'loading';
        return this.modelLoader.loadTile(tile.entry, lod);
      },
      onComplete: (object) => {
        // 오래 걸린 로딩이 끝났는데 이미 다른 LOD가 필요해졌다면 버립니다.
        if (tile.requestToken !== requestToken || tile.desiredLod !== lod) {
          this.disposer.disposeObject(object);
          tile.state = tile.object ? 'loaded' : 'unloaded';
          return;
        }

        if (tile.object) {
          this.disposeTile(tile, true);
        }

        tile.object = object;
        tile.activeLod = lod;
        tile.loadedBytes = tile.entry.lods[lod].estimatedBytes;
        tile.lastUsedAt = performance.now();
        tile.state = 'loaded';
        object.visible = false;
        this.pendingAttachTileIds.add(tile.entry.id);
      },
      onError: (error) => {
        console.error(`Failed to load tile ${tile.entry.id} (${lod})`, error);
        tile.state = 'error';
        tile.error = error instanceof Error ? error.message : 'Unknown tile loading error';
      },
    });
  }

  private detachTile(tile: TileRuntime): void {
    if (!tile.object) {
      return;
    }

    this.root.remove(tile.object);
    tile.object.visible = false;
    this.pendingAttachTileIds.delete(tile.entry.id);
    tile.state = 'unloaded';
    tile.lastUsedAt = performance.now();
  }

  private attachReadyTiles(): void {
    // GLB 파싱이 끝난 객체를 scene에 붙이는 순간에도 GPU buffer upload가 일어날 수 있습니다.
    // 한 프레임에 여러 개를 붙이면 카메라 이동 중 끊김이 커지므로, 가까운 타일부터 1개씩 붙입니다.
    const attachBudgetPerFrame = 1;
    let attachedCount = 0;

    const attachCandidates = [...this.pendingAttachTileIds]
      .map((tileId) => this.tiles.get(tileId))
      .filter((tile): tile is TileRuntime => Boolean(tile?.object))
      .sort((a, b) => a.lastDistance - b.lastDistance);

    for (const tile of attachCandidates) {
      if (attachedCount >= attachBudgetPerFrame) {
        return;
      }

      this.pendingAttachTileIds.delete(tile.entry.id);

      if (!tile.object || tile.desiredLod === null || tile.object.parent === this.root) {
        continue;
      }

      // 카메라를 돌리거나 줌하는 동안 high 타일을 공개하면 조작 중 프레임이 끊깁니다.
      // 로딩은 뒤에서 진행하되, high attach는 사용자가 멈춘 뒤 적용합니다.
      if (this.isNavigating && tile.activeLod === 'high' && this.mode === 'optimized') {
        this.pendingAttachTileIds.add(tile.entry.id);
        continue;
      }

      tile.object.visible = true;
      this.root.add(tile.object);
      tile.state = 'loaded';
      tile.lastUsedAt = performance.now();
      attachedCount += 1;

      if (this.initialDisplayMs === null) {
        this.initialDisplayMs = performance.now() - this.modeStartedAt;
      }
    }
  }

  private disposeTile(tile: TileRuntime, clearEvenAttached: boolean): void {
    if (!tile.object) {
      return;
    }

    tile.state = 'disposing';
    this.pendingAttachTileIds.delete(tile.entry.id);

    if (tile.object.parent === this.root) {
      this.root.remove(tile.object);
    } else if (!clearEvenAttached) {
      // 이미 scene 밖에 있는 detached cache만 dispose하는 경로입니다.
    }

    this.disposer.disposeObject(tile.object);
    tile.object = null;
    tile.activeLod = null;
    tile.loadedBytes = 0;
    tile.state = 'unloaded';
  }
}
