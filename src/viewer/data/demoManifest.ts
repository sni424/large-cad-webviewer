import type { CadManifest, TileManifestEntry } from '../types';

const GRID_COLUMNS = 10;
const GRID_ROWS = 8;
const TILE_SPACING = 28;

// 실제 조선 CAD 파일이 아직 없을 때 쓰는 데모 manifest입니다.
// 일부러 80개 타일을 만들어 "전체 로딩"이 확실히 무거워지도록 했습니다.
//
// optimized 모드는 카메라 근처 타일만 로딩하므로 전체 로딩과 FPS/Draw Call 차이가 커집니다.
// 실제 GLB가 생기면 procedural:// URL만 /models/*.glb로 교체하면 됩니다.
export const demoManifest: CadManifest = {
  id: 'heavy-demo-shipyard-cad',
  name: 'Heavy Demo Shipyard CAD',
  units: 'm',
  description:
    'Heavy procedural shipyard CAD tiles for demonstrating full loading lag versus camera-based LOD loading.',
  tiles: createDemoTiles(),
};

function createDemoTiles(): TileManifestEntry[] {
  const tiles: TileManifestEntry[] = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let column = 0; column < GRID_COLUMNS; column += 1) {
      const index = row * GRID_COLUMNS + column;
      const radius = 16 + (index % 5) * 2;
      const centerX = (column - (GRID_COLUMNS - 1) / 2) * TILE_SPACING;
      const centerZ = (row - (GRID_ROWS - 1) / 2) * TILE_SPACING;
      const kind = tileKind(index);
      const id = `${kind}-${String(index + 1).padStart(2, '0')}`;

      tiles.push({
        id,
        center: [centerX, 0, centerZ],
        radius,
        bounds: {
          min: [centerX - radius, -2, centerZ - radius],
          max: [centerX + radius, 18 + (index % 4) * 3, centerZ + radius],
        },
        lods: {
          high: {
            url: `procedural://shipyard/${id}/high`,
            estimatedBytes: 18_000_000 + (index % 7) * 1_250_000,
          },
          medium: {
            url: `procedural://shipyard/${id}/medium`,
            estimatedBytes: 2_600_000 + (index % 5) * 420_000,
          },
          proxy: {
            url: `procedural://shipyard/${id}/proxy`,
            estimatedBytes: 120_000 + (index % 4) * 25_000,
          },
        },
        metadataUrl: `/metadata/${id}.json`,
      });
    }
  }

  return tiles;
}

function tileKind(index: number): string {
  const kinds = ['hull-block', 'pipe-rack', 'engine-room', 'deck-equipment', 'pump-skid'];
  return kinds[index % kinds.length];
}
