import type { LodLevel, TileRuntime } from '../types';

// LOD 전환 거리입니다.
// enter와 leave 값을 분리해서 카메라가 경계선 근처에 있을 때
// high <-> medium <-> proxy가 계속 흔들리는 현상을 줄입니다.
export interface LODThresholds {
  enterHigh: number;
  leaveHigh: number;
  enterMedium: number;
  leaveMedium: number;
  reloadDistance: number;
  unloadDistance: number;
}

const DEFAULT_THRESHOLDS: LODThresholds = {
  enterHigh: 18,
  leaveHigh: 26,
  enterMedium: 42,
  leaveMedium: 56,
  reloadDistance: 70,
  unloadDistance: 86,
};

// 카메라와 타일의 거리를 보고 어떤 LOD를 써야 하는지 결정합니다.
export class LODController {
  private readonly thresholds: LODThresholds;

  constructor(thresholds: LODThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  getDesiredLod(tile: TileRuntime, distanceToCamera: number): LodLevel | null {
    // 타일 중심이 아니라 타일 표면까지의 대략적인 거리로 판단합니다.
    const distanceFromTileSurface = Math.max(0, distanceToCamera - tile.entry.radius);

    // 현재 목표 LOD가 있으면 그 값을 우선 봅니다.
    // 로딩 중인 상태에서도 같은 기준으로 hysteresis를 적용하기 위해서입니다.
    const currentLod = tile.desiredLod ?? tile.activeLod;

    // 아직 로딩되지 않은 타일이 너무 멀면 아예 로딩하지 않습니다.
    if (currentLod === null && distanceFromTileSurface > this.thresholds.reloadDistance) {
      return null;
    }

    // 이미 로딩된 타일도 너무 멀어지면 unload 대상이 됩니다.
    if (currentLod !== null && distanceFromTileSurface > this.thresholds.unloadDistance) {
      return null;
    }

    if (currentLod === 'high') {
      return distanceFromTileSurface > this.thresholds.leaveHigh ? 'medium' : 'high';
    }

    if (currentLod === 'medium') {
      if (distanceFromTileSurface < this.thresholds.enterHigh) {
        return 'high';
      }

      if (distanceFromTileSurface > this.thresholds.leaveMedium) {
        return 'proxy';
      }

      return 'medium';
    }

    if (currentLod === 'proxy') {
      if (distanceFromTileSurface < this.thresholds.enterHigh) {
        return 'high';
      }

      if (distanceFromTileSurface < this.thresholds.enterMedium) {
        return 'medium';
      }

      return 'proxy';
    }

    // 처음 로딩되는 타일은 거리 기준으로 바로 적절한 LOD를 고릅니다.
    if (distanceFromTileSurface < this.thresholds.enterHigh) {
      return 'high';
    }

    if (distanceFromTileSurface < this.thresholds.enterMedium) {
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
}
