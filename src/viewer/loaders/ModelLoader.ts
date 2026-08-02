import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { LodLevel, TileManifestEntry } from '../types';
import { ProceduralTileFactory } from './ProceduralTileFactory';

// 타일 URL을 보고 실제 모델을 로딩하는 진입점입니다.
// 지금은 procedural:// 과 GLB URL을 둘 다 처리합니다.
export class ModelLoader {
  private readonly gltfLoader = new GLTFLoader();
  private readonly proceduralTileFactory = new ProceduralTileFactory();

  async loadTile(entry: TileManifestEntry, lod: LodLevel): Promise<THREE.Object3D> {
    const asset = entry.lods[lod];

    // 테스트용 URL입니다. 실제 네트워크 요청 없이 코드로 모델을 만듭니다.
    if (asset.url.startsWith('procedural://')) {
      return this.proceduralTileFactory.createTile(entry, lod);
    }

    // 나중에 manifest의 URL을 /models/*.glb로 바꾸면 이 경로를 탑니다.
    const gltf = await this.gltfLoader.loadAsync(asset.url);
    const scene = gltf.scene;
    scene.name = `${entry.id}-${lod}`;

    return scene;
  }
}
