import fs from "node:fs";
import path from "node:path";

// OCCT split export가 원본 XCAF document label을 그대로 쓰면 색상은 잘 보존되지만,
// 각 GLB의 좌표가 원본 CAD 좌표계에 남을 수 있습니다.
// 이 스크립트는 mesh/material/bin chunk를 건드리지 않고 scene root에 transform node만 추가해
// viewer manifest 좌표계와 맞춥니다.
//
// 주의:
// OCCT writer가 이미 meter 단위로 내보낸 GLB에는 scale=1을 써야 합니다.
// scale=0.001을 한 번 더 적용하면 모델이 너무 작아져 화면에서 거의 안 보입니다.
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

  // GLB 파일은 12 byte header 뒤에 JSON chunk와 BIN chunk가 이어지는 구조입니다.
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

    // JSON chunk에는 node/material/mesh/accessor 같은 glTF 구조 정보가 들어 있습니다.
    if (chunkType === "JSON") {
      json = JSON.parse(buffer.toString("utf8", chunkStart, chunkEnd).trim());
    // BIN chunk에는 vertex/index buffer 같은 실제 binary geometry 데이터가 들어 있습니다.
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
  // glTF/GLB chunk 길이는 4 byte alignment를 맞춰야 합니다.
  const padding = (4 - (buffer.length % 4)) % 4;
  if (padding === 0) {
    return buffer;
  }

  return Buffer.concat([buffer, Buffer.alloc(padding, padByte)]);
}

function writeGlb(filePath, json, bin) {
  // JSON만 바꾸고 BIN은 그대로 다시 붙입니다.
  // 그래서 geometry, material texture binary가 깨질 위험을 최소화합니다.
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

  // 같은 파일에 여러 번 적용하면 transform이 중복되어 위치가 틀어지므로 한 번만 적용합니다.
  if (hasNormalizationNode(json)) {
    return "skipped";
  }

  json.nodes ??= [];
  json.scenes ??= [{ nodes: [] }];

  const [offsetX, offsetY, offsetZ] = offset;
  // glTF matrix는 column-major 순서입니다.
  // translation은 마지막 column의 x/y/z 위치에 들어갑니다.
  const matrix = [
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, scale, 0,
    -offsetX * scale, -offsetY * scale, -offsetZ * scale, 1,
  ];

  for (const scene of json.scenes) {
    const oldRoots = [...(scene.nodes ?? [])];
    const wrapperIndex = json.nodes.length;

    // 기존 root node들을 새 normalization node 아래로 밀어 넣습니다.
    // 이렇게 하면 원본 node hierarchy/material/mesh 참조는 그대로 보존됩니다.
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

  // 폴더를 넘기면 그 안의 모든 .glb에 같은 normalization을 적용합니다.
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
