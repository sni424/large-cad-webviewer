import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    target: "",
    offset: [0, 0, 0],
    scale: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--offset") {
      args.offset = argv[++index].split(",").map(Number);
      continue;
    }

    if (value === "--scale") {
      args.scale = Number(argv[++index]);
      continue;
    }

    if (!args.target) {
      args.target = value;
    }
  }

  if (!args.target || args.offset.length !== 3 || args.offset.some(Number.isNaN) || !Number.isFinite(args.scale)) {
    throw new Error("Usage: node add-root-normalization.mjs <glb-file-or-folder> --offset x,y,z --scale n");
  }

  return args;
}

function readGlb(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error(`${filePath} is not a GLB file`);
  }

  let offset = 12;
  let json = null;
  let bin = null;

  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("utf8", offset + 4, offset + 8);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkType === "JSON") {
      json = JSON.parse(buffer.toString("utf8", chunkStart, chunkEnd).trim());
    } else if (chunkType === "BIN\0") {
      bin = buffer.subarray(chunkStart, chunkEnd);
    }

    offset = chunkEnd;
  }

  if (!json) {
    throw new Error(`${filePath} has no JSON chunk`);
  }

  return { json, bin };
}

function pad4(buffer, padByte) {
  const padding = (4 - (buffer.length % 4)) % 4;
  if (padding === 0) {
    return buffer;
  }

  return Buffer.concat([buffer, Buffer.alloc(padding, padByte)]);
}

function writeGlb(filePath, json, bin) {
  const jsonBuffer = pad4(Buffer.from(`${JSON.stringify(json)}\n`, "utf8"), 0x20);
  const chunks = [];

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.write("JSON", 4, 4, "utf8");
  chunks.push(jsonHeader, jsonBuffer);

  if (bin) {
    const binBuffer = pad4(Buffer.from(bin), 0x00);
    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binBuffer.length, 0);
    binHeader.write("BIN\0", 4, 4, "utf8");
    chunks.push(binHeader, binBuffer);
  }

  const totalLength = 12 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "utf8");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  fs.writeFileSync(filePath, Buffer.concat([header, ...chunks], totalLength));
}

function hasNormalizationNode(json) {
  return (json.nodes ?? []).some((node) => node.name === "__cad_normalization__");
}

function applyRootNormalization(filePath, offset, scale) {
  const { json, bin } = readGlb(filePath);

  if (hasNormalizationNode(json)) {
    return "skipped";
  }

  json.nodes ??= [];
  json.scenes ??= [{ nodes: [] }];

  const [offsetX, offsetY, offsetZ] = offset;
  const matrix = [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    -offsetX * scale, -offsetY * scale, -offsetZ * scale, 1,
  ];

  for (const scene of json.scenes) {
    const oldRoots = [...(scene.nodes ?? [])];
    const wrapperIndex = json.nodes.length;

    json.nodes.push({
      name: "__cad_normalization__",
      matrix,
      children: oldRoots,
    });

    scene.nodes = [wrapperIndex];
  }

  writeGlb(filePath, json, bin);
  return "updated";
}

function listGlbFiles(target) {
  const stat = fs.statSync(target);

  if (stat.isDirectory()) {
    return fs.readdirSync(target)
      .filter((fileName) => fileName.toLowerCase().endsWith(".glb"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((fileName) => path.join(target, fileName));
  }

  return [target];
}

const args = parseArgs(process.argv.slice(2));
const files = listGlbFiles(args.target);
let updated = 0;
let skipped = 0;

for (const file of files) {
  const result = applyRootNormalization(file, args.offset, args.scale);
  if (result === "updated") {
    updated += 1;
  } else {
    skipped += 1;
  }
}

console.log(`root normalization complete: updated=${updated}, skipped=${skipped}`);