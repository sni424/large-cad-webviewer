import fs from 'node:fs';
import path from 'node:path';

const sourceGlbPath = process.argv[2] ?? 'public/models/cargo-ship.glb';
const targetDir = process.argv[3] ?? 'public/models/cargo-ship-components';

const source = readGlb(path.resolve(process.cwd(), sourceGlbPath));
const sourcePrimitives = collectPrimitives(source.json);
const materialPayload = {
  materials: source.json.materials,
  textures: source.json.textures,
  images: source.json.images,
  samplers: source.json.samplers,
};

if (!materialPayload.materials?.length) {
  console.error(`Source GLB has no materials: ${sourceGlbPath}`);
  process.exit(1);
}

const targetFiles = fs
  .readdirSync(targetDir)
  .filter((name) => name.toLowerCase().endsWith('.glb'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

let sourcePrimitiveOffset = 0;

for (const fileName of targetFiles) {
  const filePath = path.join(targetDir, fileName);
  const target = readGlb(filePath);
  const targetPrimitives = collectPrimitives(target.json);

  target.json.materials = materialPayload.materials;

  if (materialPayload.textures) {
    target.json.textures = materialPayload.textures;
  }

  if (materialPayload.images) {
    target.json.images = materialPayload.images;
  }

  if (materialPayload.samplers) {
    target.json.samplers = materialPayload.samplers;
  }

  for (let index = 0; index < targetPrimitives.length; index += 1) {
    const sourcePrimitive = sourcePrimitives[sourcePrimitiveOffset + index];

    if (sourcePrimitive?.material !== undefined) {
      targetPrimitives[index].material = sourcePrimitive.material;
    }
  }

  sourcePrimitiveOffset += targetPrimitives.length;
  writeGlb(filePath, target.json, target.binChunk);

  console.log(`restored materials: ${filePath} (${targetPrimitives.length} primitives)`);
}

console.log(
  `Done. Assigned ${sourcePrimitiveOffset} primitive material references from ${sourcePrimitives.length} source primitives.`,
);

function collectPrimitives(json) {
  return (json.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
}

function readGlb(filePath) {
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.toString('utf8', 0, 4);
  const version = buffer.readUInt32LE(4);

  if (magic !== 'glTF' || version !== 2) {
    throw new Error(`Only GLB v2 files are supported: ${filePath}`);
  }

  let json = null;
  let binChunk = null;
  let offset = 12;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString('utf8', offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    const chunkData = buffer.subarray(chunkStart, chunkEnd);

    if (chunkType === 'JSON') {
      json = JSON.parse(chunkData.toString('utf8').trim());
    } else if (chunkType === 'BIN\0') {
      binChunk = Buffer.from(chunkData);
    }

    offset = chunkEnd;
  }

  if (!json || !binChunk) {
    throw new Error(`Invalid GLB chunks: ${filePath}`);
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
