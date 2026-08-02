import * as THREE from 'three';
import type { LodLevel, TileManifestEntry } from '../types';

// 실제 GLB가 아직 없을 때 쓰는 임시 CAD 모델 생성기입니다.
// 중요한 점은 "그럴듯한 모양"보다 "LOD별 복잡도 차이"를 만드는 것입니다.
// 그래야 전체 로딩과 최적화 로딩의 성능 차이를 화면에서 비교할 수 있습니다.
export class ProceduralTileFactory {
  async createTile(entry: TileManifestEntry, lod: LodLevel): Promise<THREE.Object3D> {
    await this.simulateLoadDelay(lod);

    const group = new THREE.Group();
    group.name = `${entry.id}-${lod}`;
    group.position.set(entry.center[0], entry.center[1], entry.center[2]);

    if (lod === 'proxy') {
      this.addProxyBox(group, entry);
      return group;
    }

    this.addEquipmentBlocks(group, entry, lod);
    this.addPipeRuns(group, entry, lod);
    this.addFrameLines(group, entry, lod);

    return group;
  }

  // 가장 먼 거리에서 쓰는 아주 가벼운 대체 모델입니다.
  // 실제 서비스에서는 타일 bounding box 또는 단순화된 GLB가 여기에 해당합니다.
  private addProxyBox(group: THREE.Group, entry: TileManifestEntry): void {
    const size = this.getTileSize(entry);
    const geometry = new THREE.BoxGeometry(size.x, Math.max(size.y, 3), size.z);
    const material = new THREE.MeshStandardMaterial({
      color: 0x577986,
      roughness: 0.8,
      metalness: 0.05,
      transparent: true,
      opacity: 0.45,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${entry.id}-proxy`;
    mesh.position.y = Math.max(size.y, 3) * 0.5;
    group.add(mesh);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x9bd3e3,
        transparent: true,
        opacity: 0.65,
      }),
    );
    edges.position.copy(mesh.position);
    group.add(edges);
  }

  // 장비, 선체 블록, 구조물처럼 보이는 박스 묶음입니다.
  private addEquipmentBlocks(group: THREE.Group, entry: TileManifestEntry, lod: LodLevel): void {
    const seed = this.seed(entry.id);
    // high는 일부러 객체 수와 세그먼트 수를 크게 잡았습니다.
    // 전체 로딩 모드에서 draw call과 triangle이 확 올라가도록 만드는 장치입니다.
    const blockCount = lod === 'high' ? 46 : 5;
    const segmentCount = lod === 'high' ? 8 : 1;

    for (let index = 0; index < blockCount; index += 1) {
      const width = 5 + ((seed + index * 7) % 9);
      const height = 2.5 + ((seed + index * 3) % 6);
      const depth = 4 + ((seed + index * 5) % 8);

      const geometry = new THREE.BoxGeometry(width, height, depth, segmentCount, 1, segmentCount);
      const material = new THREE.MeshStandardMaterial({
        color: this.pickColor(seed + index),
        roughness: 0.58,
        metalness: 0.14,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${entry.id}-equipment-${index}`;
      mesh.position.set(
        ((index % 3) - 1) * entry.radius * 0.38,
        height * 0.5,
        (Math.floor(index / 3) - 1) * entry.radius * 0.32,
      );
      mesh.rotation.y = (((seed + index) % 9) - 4) * 0.035;
      group.add(mesh);
    }
  }

  // 조선 CAD에서 성능을 많이 잡아먹는 배관 느낌을 내기 위한 cylinder 묶음입니다.
  private addPipeRuns(group: THREE.Group, entry: TileManifestEntry, lod: LodLevel): void {
    const seed = this.seed(entry.id);
    const pipeCount = lod === 'high' ? 140 : 12;
    const radialSegments = lod === 'high' ? 32 : 8;

    for (let index = 0; index < pipeCount; index += 1) {
      const radius = 0.08 + ((seed + index) % 5) * 0.035;
      const length = entry.radius * (0.45 + ((seed + index * 11) % 45) / 100);
      const geometry = new THREE.CylinderGeometry(radius, radius, length, radialSegments);
      const material = new THREE.MeshStandardMaterial({
        color: this.pickPipeColor(seed + index),
        roughness: 0.42,
        metalness: 0.22,
      });

      const pipe = new THREE.Mesh(geometry, material);
      pipe.name = `${entry.id}-pipe-${index}`;

      if (index % 2 === 0) {
        pipe.rotation.z = Math.PI / 2;
      } else {
        pipe.rotation.x = Math.PI / 2;
      }

      pipe.position.set(
        (((seed + index * 3) % 100) / 100 - 0.5) * entry.radius * 1.35,
        2 + ((seed + index * 13) % 9),
        (((seed + index * 17) % 100) / 100 - 0.5) * entry.radius * 1.35,
      );
      group.add(pipe);
    }
  }

  // 구조 프레임 느낌을 주는 선형 객체입니다.
  // line도 geometry/material을 가지므로 dispose 대상입니다.
  private addFrameLines(group: THREE.Group, entry: TileManifestEntry, lod: LodLevel): void {
    const frameCount = lod === 'high' ? 60 : 6;

    for (let index = 0; index < frameCount; index += 1) {
      const width = entry.radius * (0.45 + (index % 4) * 0.08);
      const height = 4 + (index % 5);
      const depth = entry.radius * 0.3;

      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-width / 2, 0, -depth / 2),
        new THREE.Vector3(width / 2, 0, -depth / 2),
        new THREE.Vector3(width / 2, height, -depth / 2),
        new THREE.Vector3(-width / 2, height, -depth / 2),
        new THREE.Vector3(-width / 2, 0, -depth / 2),
        new THREE.Vector3(-width / 2, 0, depth / 2),
        new THREE.Vector3(width / 2, 0, depth / 2),
        new THREE.Vector3(width / 2, height, depth / 2),
        new THREE.Vector3(-width / 2, height, depth / 2),
        new THREE.Vector3(-width / 2, 0, depth / 2),
      ]);

      const material = new THREE.LineBasicMaterial({
        color: 0xb8c4cb,
        transparent: true,
        opacity: 0.55,
      });
      const frame = new THREE.Line(geometry, material);
      frame.name = `${entry.id}-frame-${index}`;
      frame.position.set((index - frameCount / 2) * 1.8, 0.08, ((index % 3) - 1) * 4);
      group.add(frame);
    }
  }

  private getTileSize(entry: TileManifestEntry): THREE.Vector3 {
    if (!entry.bounds) {
      return new THREE.Vector3(entry.radius * 1.4, entry.radius * 0.7, entry.radius * 1.4);
    }

    return new THREE.Vector3(
      entry.bounds.max[0] - entry.bounds.min[0],
      entry.bounds.max[1] - entry.bounds.min[1],
      entry.bounds.max[2] - entry.bounds.min[2],
    );
  }

  private simulateLoadDelay(lod: LodLevel): Promise<void> {
    const delayMs = lod === 'high' ? 240 : lod === 'medium' ? 70 : 20;
    return new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  }

  private pickColor(seed: number): number {
    const colors = [0x62717c, 0x76866d, 0x6f7c91, 0x7b7788];
    return colors[seed % colors.length];
  }

  private pickPipeColor(seed: number): number {
    const colors = [0x6dc7d9, 0xd8bd67, 0xa9b7bf, 0x8fbf8f];
    return colors[seed % colors.length];
  }

  private seed(value: string): number {
    let result = 0;

    for (let index = 0; index < value.length; index += 1) {
      result = (result * 31 + value.charCodeAt(index)) >>> 0;
    }

    return result;
  }
}
