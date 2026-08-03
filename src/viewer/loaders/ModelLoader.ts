import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

    return this.optimizeStaticCadObject(scene);
  }

  private optimizeStaticCadObject(scene: THREE.Object3D): THREE.Object3D {
    const meshGroups = new Map<string, Array<THREE.Mesh>>();
    const preservedMeshes: Array<THREE.Mesh> = [];

    scene.updateWorldMatrix(true, true);
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) {
        return;
      }

      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = true;
      object.matrixAutoUpdate = false;

      // 텍스처/멀티 머티리얼/geometry group이 있는 mesh는 병합하지 않습니다.
      // 이런 mesh를 무리하게 merge하면 UV, group, material index가 깨져서 텍스처가 사라질 수 있습니다.
      if (!this.canMergeWithoutChangingAppearance(object)) {
        preservedMeshes.push(this.cloneWorldSpaceMesh(object));
        return;
      }

      const materialKey = object.material.uuid;
      const group = meshGroups.get(materialKey) ?? [];

      group.push(object);
      meshGroups.set(materialKey, group);
    });

    const mergedRoot = new THREE.Group();
    mergedRoot.name = `${scene.name}-merged`;
    let mergedAny = false;

    for (const meshes of meshGroups.values()) {
      if (meshes.length === 0) {
        continue;
      }

      const geometries = meshes.map((mesh) => {
        const geometry = mesh.geometry.clone();

        geometry.applyMatrix4(mesh.matrixWorld);
        return geometry;
      });

      const mergedGeometry = mergeGeometries(geometries, false);

      for (const geometry of geometries) {
        geometry.dispose();
      }

      if (!mergedGeometry) {
        for (const mesh of meshes) {
          preservedMeshes.push(this.cloneWorldSpaceMesh(mesh));
        }
        continue;
      }

      const sourceMaterial = meshes[0].material;
      const mergedMesh = new THREE.Mesh(mergedGeometry, sourceMaterial);

      mergedMesh.name = `${scene.name}-batch-${mergedRoot.children.length + 1}`;
      mergedMesh.castShadow = false;
      mergedMesh.receiveShadow = false;
      mergedMesh.frustumCulled = true;
      mergedMesh.matrixAutoUpdate = false;
      mergedRoot.add(mergedMesh);
      mergedAny = true;
    }

    for (const mesh of preservedMeshes) {
      mergedRoot.add(mesh);
    }

    if (!mergedAny && preservedMeshes.length === 0) {
      return scene;
    }

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
      }
    });

    return mergedRoot;
  }

  private canMergeWithoutChangingAppearance(mesh: THREE.Mesh): mesh is THREE.Mesh<
    THREE.BufferGeometry,
    THREE.Material
  > {
    if (Array.isArray(mesh.material)) {
      return false;
    }

    if (mesh.geometry.groups.length > 0) {
      return false;
    }

    return !this.hasTextureMap(mesh.material);
  }

  private hasTextureMap(material: THREE.Material): boolean {
    const textureKeys = [
      'map',
      'aoMap',
      'alphaMap',
      'bumpMap',
      'displacementMap',
      'emissiveMap',
      'envMap',
      'lightMap',
      'metalnessMap',
      'normalMap',
      'roughnessMap',
    ] as const;

    const materialRecord = material as unknown as Record<string, unknown>;

    return textureKeys.some((key) => materialRecord[key] instanceof THREE.Texture);
  }

  private cloneWorldSpaceMesh(mesh: THREE.Mesh): THREE.Mesh {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);

    const clone = new THREE.Mesh(geometry, mesh.material);
    clone.name = mesh.name;
    clone.castShadow = false;
    clone.receiveShadow = false;
    clone.frustumCulled = true;
    clone.matrixAutoUpdate = false;

    return clone;
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
