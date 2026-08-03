import * as THREE from 'three';
import type { LodLevel, TileRuntime } from '../types';

// 카메라 거리와 화면 크기를 같이 쓰는 LOD 기준입니다.
// Cargo STEP처럼 타일 크기가 크게 다른 데이터는 radius 기반 화면 크기만 쓰면
// 같은 거리의 작은 부품과 큰 선체가 서로 다르게 사라집니다.
export interface LODThresholds {
  enterHighDistance: number;
  leaveHighDistance: number;
  enterMediumDistance: number;
  leaveMediumDistance: number;
  loadDistance: number;
  unloadDistance: number;
}

export interface LODEvaluationInput {
  camera: THREE.Camera;
  viewportHeight: number;
}

const DEFAULT_THRESHOLDS: LODThresholds = {
  enterHighDistance: 58,
  leaveHighDistance: 72,
  enterMediumDistance: 108,
  leaveMediumDistance: 130,
  loadDistance: 145,
  unloadDistance: 165,
};

// 카메라에서 타일 중심까지의 거리 band를 우선하고,
// 화면에서 정말 작아진 타일만 추가로 unload합니다.
export class LODController {
  private readonly thresholds: LODThresholds;

  constructor(thresholds: LODThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  getDesiredLod(tile: TileRuntime, input: LODEvaluationInput): LodLevel | null {
    const centerDistance = this.getCenterDistance(tile, input.camera);

    // 현재 목표 LOD가 있으면 그 값을 우선 봅니다.
    // 로딩 중인 상태에서도 같은 기준으로 hysteresis를 적용하기 위해서입니다.
    const currentLod = tile.desiredLod ?? tile.activeLod;

    // 같은 거리의 부품들이 들쭉날쭉하게 보이지 않도록 중심 거리 band를 먼저 적용합니다.
    if (currentLod === null && centerDistance > this.thresholds.loadDistance) {
      return null;
    }

    if (currentLod !== null && centerDistance > this.thresholds.unloadDistance) {
      return null;
    }

    if (currentLod === 'high') {
      return centerDistance > this.thresholds.leaveHighDistance ? 'medium' : 'high';
    }

    if (currentLod === 'medium') {
      if (centerDistance < this.thresholds.enterHighDistance) {
        return 'high';
      }

      if (centerDistance > this.thresholds.leaveMediumDistance) {
        return 'proxy';
      }

      return 'medium';
    }

    if (currentLod === 'proxy') {
      if (centerDistance < this.thresholds.enterHighDistance) {
        return 'high';
      }

      if (centerDistance < this.thresholds.enterMediumDistance) {
        return 'medium';
      }

      return 'proxy';
    }

    // 처음 로딩되는 타일은 거리 band 기준으로 바로 적절한 LOD를 고릅니다.
    if (centerDistance < this.thresholds.enterHighDistance) {
      return 'high';
    }

    if (centerDistance < this.thresholds.enterMediumDistance) {
      return 'medium';
    }

    return 'proxy';
  }

  // 로딩 큐에서 가까운 타일을 먼저 처리하기 위한 우선순위입니다.
  // 숫자가 낮을수록 먼저 로딩됩니다.
  getPriority(tile: TileRuntime, distanceToCamera: number, lod: LodLevel): number {
    const lodPenalty = lod === 'high' ? 0 : lod === 'medium' ? 250 : 500;

    return distanceToCamera + lodPenalty + tile.entry.radius * 0.1;
  }

  private getCenterDistance(tile: TileRuntime, camera: THREE.Camera): number {
    const tileCenter = new THREE.Vector3(
      tile.entry.center[0],
      tile.entry.center[1],
      tile.entry.center[2],
    );

    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);

    return cameraPosition.distanceTo(tileCenter);
  }
}
