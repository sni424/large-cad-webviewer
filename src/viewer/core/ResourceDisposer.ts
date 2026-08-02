import * as THREE from 'three';

// Three.js는 scene에서 object를 remove한다고 GPU 자원이 자동으로 해제되지 않습니다.
// 멀어진 타일을 unload할 때 geometry/material/texture를 직접 dispose해야 합니다.
export class ResourceDisposer {
  disposeObject(object: THREE.Object3D): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    object.traverse((child) => {
      const maybeMesh = child as THREE.Mesh;

      if (maybeMesh.geometry) {
        geometries.add(maybeMesh.geometry);
      }

      const material = maybeMesh.material;

      if (Array.isArray(material)) {
        material.forEach((item) => this.collectMaterial(item, materials, textures));
      } else if (material) {
        this.collectMaterial(material, materials, textures);
      }
    });

    // Set을 쓰는 이유:
    // 여러 mesh가 같은 material/texture를 공유할 수 있어서 중복 dispose를 피해야 합니다.
    geometries.forEach((geometry) => geometry.dispose());
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());

    // 자식 참조까지 끊어 GC가 회수하기 쉽게 만듭니다.
    object.clear();
  }

  private collectMaterial(
    material: THREE.Material,
    materials: Set<THREE.Material>,
    textures: Set<THREE.Texture>,
  ): void {
    materials.add(material);

    // MeshStandardMaterial.map, normalMap, roughnessMap 등 texture 필드를 한 번에 수집합니다.
    const materialRecord = material as unknown as Record<string, unknown>;

    for (const value of Object.values(materialRecord)) {
      if (value instanceof THREE.Texture) {
        textures.add(value);
      }
    }
  }
}
