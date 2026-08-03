import fs from 'node:fs';
import path from 'node:path';

const targetPath = process.argv[2] ?? 'public/models/cargo-ship-components';
const resolvedTarget = path.resolve(process.cwd(), targetPath);

if (!fs.existsSync(resolvedTarget)) {
  console.error(`Path not found: ${resolvedTarget}`);
  process.exit(1);
}

const files = collectGlbFiles(resolvedTarget);

if (files.length === 0) {
  console.error(`No GLB files found: ${resolvedTarget}`);
  process.exit(1);
}

const rows = files
  .map((filePath) => analyzeGlb(filePath))
  .sort((a, b) => b.bytes - a.bytes);

const totals = rows.reduce(
  (sum, row) => ({
    bytes: sum.bytes + row.bytes,
    nodes: sum.nodes + row.nodes,
    meshes: sum.meshes + row.meshes,
    primitives: sum.primitives + row.primitives,
    materials: Math.max(sum.materials, row.materials),
    triangles: sum.triangles + row.triangles,
    vertices: sum.vertices + row.vertices,
  }),
  {
    bytes: 0,
    nodes: 0,
    meshes: 0,
    primitives: 0,
    materials: 0,
    triangles: 0,
    vertices: 0,
  },
);

console.table(
  rows.map((row) => ({
    file: row.file,
    mb: toMb(row.bytes),
    nodes: row.nodes,
    meshes: row.meshes,
    primitives: row.primitives,
    materials: row.materials,
    triangles: row.triangles,
    vertices: row.vertices,
  })),
);

console.log('Totals');
console.table([
  {
    files: rows.length,
    mb: toMb(totals.bytes),
    nodes: totals.nodes,
    meshes: totals.meshes,
    primitives: totals.primitives,
    maxMaterialsPerFile: totals.materials,
    triangles: totals.triangles,
    vertices: totals.vertices,
  },
]);

function collectGlbFiles(inputPath) {
  const stat = fs.statSync(inputPath);

  if (stat.isFile()) {
    return inputPath.toLowerCase().endsWith('.glb') ? [inputPath] : [];
  }

  return fs
    .readdirSync(inputPath, { withFileTypes: true })
    .flatMap((entry) => {
      const childPath = path.join(inputPath, entry.name);

      if (entry.isDirectory()) {
        return collectGlbFiles(childPath);
      }

      return entry.name.toLowerCase().endsWith('.glb') ? [childPath] : [];
    });
}

function analyzeGlb(filePath) {
  const buffer = fs.readFileSync(filePath);
  const json = readGlbJson(buffer);
  const accessors = json.accessors ?? [];
  const meshes = json.meshes ?? [];
  const nodes = json.nodes ?? [];
  const materials = json.materials ?? [];

  let primitives = 0;
  let triangles = 0;
  let vertices = 0;

  for (const mesh of meshes) {
    for (const primitive of mesh.primitives ?? []) {
      primitives += 1;
      vertices += getPositionCount(primitive, accessors);
      triangles += getTriangleCount(primitive, accessors);
    }
  }

  return {
    file: path.relative(process.cwd(), filePath),
    bytes: buffer.byteLength,
    nodes: nodes.length,
    meshes: meshes.length,
    primitives,
    materials: materials.length,
    triangles,
    vertices,
  };
}

function readGlbJson(buffer) {
  const magic = buffer.toString('utf8', 0, 4);
  const version = buffer.readUInt32LE(4);

  if (magic !== 'glTF' || version !== 2) {
    throw new Error('Only GLB v2 files are supported.');
  }

  let offset = 12;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString('utf8', offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkType === 'JSON') {
      return JSON.parse(buffer.toString('utf8', chunkStart, chunkEnd).trim());
    }

    offset = chunkEnd;
  }

  throw new Error('GLB JSON chunk was not found.');
}

function getPositionCount(primitive, accessors) {
  const positionAccessorIndex = primitive.attributes?.POSITION;

  if (positionAccessorIndex === undefined) {
    return 0;
  }

  return accessors[positionAccessorIndex]?.count ?? 0;
}

function getTriangleCount(primitive, accessors) {
  const mode = primitive.mode ?? 4;

  if (mode !== 4) {
    return 0;
  }

  if (primitive.indices !== undefined) {
    return Math.floor((accessors[primitive.indices]?.count ?? 0) / 3);
  }

  return Math.floor(getPositionCount(primitive, accessors) / 3);
}

function toMb(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}
