import * as THREE from 'three';
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

    // 실제 CAD 타일의 먼 거리 LOD용 프록시입니다.
    // GLB를 로딩하지 않고 manifest의 bounds만 사용해 아주 가벼운 박스를 만듭니다.
    if (asset.url.startsWith('proxy-box://')) {
      return this.createProxyBox(entry, lod);
    }

    // 나중에 manifest의 URL을 /models/*.glb로 바꾸면 이 경로를 탑니다.
    const gltf = await this.gltfLoader.loadAsync(asset.url);
    const scene = gltf.scene;
    scene.name = `${entry.id}-${lod}`;

    return scene;
  }

  private createProxyBox(entry: TileManifestEntry, lod: LodLevel): THREE.Object3D {
    const group = new THREE.Group();
    group.name = `${entry.id}-${lod}-proxy`;

    const min = entry.bounds?.min ?? [
      entry.center[0] - entry.radius,
      entry.center[1] - entry.radius,
      entry.center[2] - entry.radius,
    ];
    const max = entry.bounds?.max ?? [
      entry.center[0] + entry.radius,
      entry.center[1] + entry.radius,
      entry.center[2] + entry.radius,
    ];

    const width = Math.max(0.1, max[0] - min[0]);
    const height = Math.max(0.1, max[1] - min[1]);
    const depth = Math.max(0.1, max[2] - min[2]);
    const centerX = (min[0] + max[0]) * 0.5;
    const centerY = (min[1] + max[1]) * 0.5;
    const centerZ = (min[2] + max[2]) * 0.5;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({
        color: '#67e8f9',
        transparent: true,
        opacity: 0.18,
        roughness: 0.85,
        metalness: 0.02,
      }),
    );
    mesh.position.set(centerX, centerY, centerZ);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry),
      new THREE.LineBasicMaterial({ color: '#a5f3fc', transparent: true, opacity: 0.45 }),
    );
    edges.position.copy(mesh.position);

    group.add(mesh, edges);

    return group;
  }
}
