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
    // 목적:
    // 1. 같은 material을 쓰는 단순 mesh는 합쳐서 draw call을 줄입니다.
    // 2. material array, texture, geometry group이 있는 mesh는 외형이 깨질 수 있어 보존합니다.
    //
    // STEP에서 나온 CAD GLB는 이미지 텍스처보다 face color/material이 많은 편이라,
    // 무리한 merge보다 "깨지지 않는 선에서만 merge"가 더 중요합니다.
    const meshGroups = new Map<string, Array<THREE.Mesh>>();
    const preservedMeshes: Array<THREE.Mesh> = [];

    // 각 mesh의 local transform까지 geometry에 bake하려면 world matrix가 최신이어야 합니다.
    scene.updateWorldMatrix(true, true);
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) {
        return;
      }

      object.castShadow = false;
      object.receiveShadow = false;
      object.frustumCulled = true;
      // CAD 모델은 로딩 후 움직이지 않으므로 matrix update 비용을 줄입니다.
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

        // 여러 mesh를 하나의 geometry로 합치려면 각 mesh의 world transform을 vertex에 적용해야 합니다.
        geometry.applyMatrix4(mesh.matrixWorld);
        return geometry;
      });

      // false: geometry groups를 새로 만들지 않고 완전히 하나의 material mesh로 합칩니다.
      // 이 경로는 같은 material끼리만 들어오므로 group 정보가 필요 없습니다.
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
        // 원본 scene은 더 이상 쓰지 않으므로 geometry만 정리합니다.
        // material은 merged mesh가 그대로 참조할 수 있으므로 여기서 dispose하지 않습니다.
        object.geometry.dispose();
      }
    });

    return mergedRoot;
  }

  private canMergeWithoutChangingAppearance(mesh: THREE.Mesh): mesh is THREE.Mesh<
    THREE.BufferGeometry,
    THREE.Material
  > {
    // material 배열은 geometry.groups의 materialIndex와 함께 해석됩니다.
    // 이 상태를 단순 merge하면 빨강/흰색 같은 face color가 뒤섞일 수 있습니다.
    if (Array.isArray(mesh.material)) {
      return false;
    }

    // groups가 있으면 한 geometry 안에서도 영역별 material이 다를 수 있습니다.
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
    // 보존 대상 mesh도 원본 scene hierarchy에서 분리하기 위해 clone합니다.
    // 이때 transform은 geometry에 bake하고 clone 자체는 identity transform으로 둡니다.
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
    // proxy는 "실제 GLB를 대체하는 아주 가벼운 시각 힌트"입니다.
    // 먼 거리에서 전체 형태/위치만 보여주고 triangle, material, draw call을 줄입니다.
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
