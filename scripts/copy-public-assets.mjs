import fs from 'node:fs';
import path from 'node:path';

// Vite 설정에서 copyPublicDir=false를 쓰고 있어서,
// Vercel 배포에 필요한 정적 CAD 산출물만 dist로 직접 복사합니다.
// STEP 원본은 public/cad에 있지만 브라우저 런타임에서 쓰지 않으므로 배포하지 않습니다.

const copyTargets = [
  ['public/manifests', 'dist/manifests'],
  ['public/models', 'dist/models'],
];

function copyDirectory(source, target) {
  if (!fs.existsSync(source)) {
    return;
  }

  fs.mkdirSync(target, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

for (const [source, target] of copyTargets) {
  copyDirectory(source, target);
}

console.log('Copied Vercel static assets: manifests, models');
