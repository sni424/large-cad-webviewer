import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // 실제 CAD/GLB 산출물은 프론트엔드 번들에 복사하지 않습니다.
    // 개발 서버에서는 public/ 아래에서 확인하고, 제품 단계에서는 CDN/object storage로 분리하는 구조가 맞습니다.
    copyPublicDir: false,
    minify: 'esbuild',
  },
});
