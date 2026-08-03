import fs from 'node:fs';
import path from 'node:path';

const sourceGlbPath = process.argv[2] ?? 'public/models/cargo-ship.glb';
const targetDir = process.argv[3] ?? 'public/models/cargo-ship-components';
const scale = Number(process.argv[4] ?? 0.001);

const source = readGlb(path.resolve(process.cwd(), sourceGlbPath));
const sourcePrimitiveInfos = collectPrimitiveInfos(source, true, scale);
const materialPayload = pickMaterialPayload(source.json);
const sourceBySignature = new Map();

for (const primitive of sourcePrimitiveInfos) {
  const key = makeSignature(primitive, 3);
  const list = sourceBySignature.get(key) ?? [];

  list.push(primitive);
  sourceBySignature.set(key, list);
}

let assignedTotal = 0;
let missingTotal = 0;

for (const fileName of fs.readdirSync(targetDir).filter((name) => name.endsWith('.glb')).sort(naturalSort)) {
  const filePath = path.join(targetDir, fileName);
  const target = readGlb(filePath);
  const targetPrimitiveInfos = collectPrimitiveInfos(target, false, scale);

  applyMaterialPayload(target.json, materialPayload);

  let assigned = 0;
  let missing = 0;

  for (const targetPrimitive of targetPrimitiveInfos) {
    const sourcePrimitive = findSourcePrimitive(sourceBySignature, targetPrimitive);

    if (sourcePrimitive?.material !== undefined) {
      targetPrimitive.primitive.material = sourcePrimitive.material;
      assigned += 1;
      continue;
    }

    missing += 1;
  }

  writeGlb(filePath, target.json, target.binChunk);
  assignedTotal += assigned;
  missingTotal += missing;
  console.log(`spatial material restore: ${fileName} assigned=${assigned} missing=${missing}`);
}

console.log(`Done. assigned=${assignedTotal} missing=${missingTotal}`);

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

function pickMaterialPayload(json) {
  return {
    materials: json.materials ?? [],
    textures: json.textures,
    images: json.images,
    samplers: json.samplers,
  };
}

function applyMaterialPayload(json, payload) {
  json.materials = payload.materials;

  if (payload.textures) {
    json.textures = payload.textures;
  }

  if (payload.images) {
    json.images = payload.images;
  }

  if (payload.samplers) {
    json.samplers = payload.samplers;
  }
}

function findSourcePrimitive(sourceBySignature, targetPrimitive) {
  for (const precision of [3, 2, 1]) {
    const key = makeSignature(targetPrimitive, precision);
    const candidates = sourceBySignature.get(key);

    if (!candidates?.length) {
      continue;
    }

    return candidates.shift();
  }

  return null;
}

function makeSignature(primitive, precision) {
  const round = (value) => Number(value.toFixed(precision));
  const center = primitive.center.map(round).join(',');
  const size = primitive.size.map(round).join(',');

  return `${primitive.vertexCount}|${primitive.indexCount}|${center}|${size}`;
}

function collectPrimitiveInfos(glb, shouldNormalize, scale) {
  const json = glb.json;
  const accessors = json.accessors ?? [];
  const bufferViews = json.bufferViews ?? [];
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];
  const scenes = json.scenes ?? [];
  const scene = scenes[json.scene ?? 0] ?? scenes[0];
  const meshInstances = [];
  const infos = [];
  const allPositions = [];

  for (const nodeIndex of scene?.nodes ?? nodes.map((_, index) => index)) {
    collectMeshInstances(nodes, nodeIndex, identityMatrix(), meshInstances);
  }

  for (const instance of meshInstances) {
    const mesh = meshes[instance.meshIndex];

    for (const primitive of mesh.primitives ?? []) {
      const positionAccessorIndex = primitive.attributes?.POSITION;

      if (positionAccessorIndex === undefined) {
        continue;
      }

      const positions = readVec3Accessor(glb.binChunk, accessors[positionAccessorIndex], bufferViews)
        .map((position) => transformPoint(position, instance.worldMatrix));
      allPositions.push(...positions);
    }
  }

  const normalization = shouldNormalize ? computeNormalization(allPositions, scale) : null;

  for (const instance of meshInstances) {
    const mesh = meshes[instance.meshIndex];

    for (const primitive of mesh.primitives ?? []) {
      const positionAccessorIndex = primitive.attributes?.POSITION;

      if (positionAccessorIndex === undefined) {
        continue;
      }

      const positions = readVec3Accessor(glb.binChunk, accessors[positionAccessorIndex], bufferViews)
        .map((position) => transformPoint(position, instance.worldMatrix))
        .map((position) => (normalization ? normalizePosition(position, normalization) : position));
      const bounds = computeBounds(positions);

      infos.push({
        primitive,
        material: primitive.material,
        vertexCount: positions.length,
        indexCount: primitive.indices === undefined ? 0 : accessors[primitive.indices]?.count ?? 0,
        center: [
          (bounds.min[0] + bounds.max[0]) * 0.5,
          (bounds.min[1] + bounds.max[1]) * 0.5,
          (bounds.min[2] + bounds.max[2]) * 0.5,
        ],
        size: [
          bounds.max[0] - bounds.min[0],
          bounds.max[1] - bounds.min[1],
          bounds.max[2] - bounds.min[2],
        ],
      });
    }
  }

  return infos;
}

function collectMeshInstances(nodes, nodeIndex, parentMatrix, instances) {
  const node = nodes[nodeIndex];

  if (!node) {
    return;
  }

  const worldMatrix = multiplyMatrices(parentMatrix, getNodeMatrix(node));

  if (node.mesh !== undefined) {
    instances.push({ meshIndex: node.mesh, worldMatrix });
  }

  for (const childIndex of node.children ?? []) {
    collectMeshInstances(nodes, childIndex, worldMatrix, instances);
  }
}

function getNodeMatrix(node) {
  if (node.matrix) {
    return node.matrix;
  }

  const translation = node.translation ?? [0, 0, 0];
  const scale = node.scale ?? [1, 1, 1];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const [x, y, z, w] = rotation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const sx = scale[0];
  const sy = scale[1];
  const sz = scale[2];

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(a, b) {
  const out = new Array(16).fill(0);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }

  return out;
}

function transformPoint(position, matrix) {
  const [x, y, z] = position;

  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function computeNormalization(positions, scale) {
  const bounds = computeBounds(positions);

  return {
    offset: [
      (bounds.min[0] + bounds.max[0]) * 0.5,
      bounds.min[1],
      (bounds.min[2] + bounds.max[2]) * 0.5,
    ],
    scale,
  };
}

function normalizePosition(position, normalization) {
  return [
    (position[0] - normalization.offset[0]) * normalization.scale,
    (position[1] - normalization.offset[1]) * normalization.scale,
    (position[2] - normalization.offset[2]) * normalization.scale,
  ];
}

function computeBounds(positions) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];

  for (const position of positions) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], position[axis]);
      max[axis] = Math.max(max[axis], position[axis]);
    }
  }

  return { min, max };
}

function readVec3Accessor(binChunk, accessor, bufferViews) {
  if (accessor.componentType !== 5126 || accessor.type !== 'VEC3') {
    throw new Error('Only FLOAT VEC3 POSITION accessors are supported.');
  }

  const bufferView = bufferViews[accessor.bufferView];
  const byteOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const byteStride = bufferView.byteStride ?? 12;
  const positions = [];

  for (let index = 0; index < accessor.count; index += 1) {
    const offset = byteOffset + index * byteStride;
    positions.push([
      binChunk.readFloatLE(offset),
      binChunk.readFloatLE(offset + 4),
      binChunk.readFloatLE(offset + 8),
    ]);
  }

  return positions;
}

function readGlb(filePath) {
  const buffer = fs.readFileSync(filePath);
  let json = null;
  let binChunk = null;
  let offset = 12;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString('utf8', offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    const chunk = buffer.subarray(chunkStart, chunkEnd);

    if (chunkType === 'JSON') {
      json = JSON.parse(chunk.toString('utf8').trim());
    } else if (chunkType === 'BIN\0') {
      binChunk = Buffer.from(chunk);
    }

    offset = chunkEnd;
  }

  if (!json || !binChunk) {
    throw new Error(`Invalid GLB: ${filePath}`);
  }

  return { json, binChunk };
}

function writeGlb(filePath, json, binChunk) {
  const jsonBuffer = padBuffer(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBuffer = padBuffer(binChunk, 0x00);
  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binBuffer.length;
  const header = Buffer.alloc(12);
  const jsonHeader = Buffer.alloc(8);
  const binHeader = Buffer.alloc(8);

  header.write('glTF', 0, 4, 'utf8');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.write('JSON', 4, 4, 'utf8');

  binHeader.writeUInt32LE(binBuffer.length, 0);
  binHeader.write('BIN\0', 4, 4, 'utf8');

  fs.writeFileSync(filePath, Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, binBuffer]));
}

function padBuffer(buffer, padByte) {
  const padding = (4 - (buffer.length % 4)) % 4;

  if (padding === 0) {
    return buffer;
  }

  return Buffer.concat([buffer, Buffer.alloc(padding, padByte)]);
}
