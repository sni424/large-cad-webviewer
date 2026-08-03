# React + TypeScript + Vite

## Large CAD Web Viewer PoC

대용량 CAD 데이터를 웹에서 바로 보여주는 상황을 가정하고, 전체 로딩 방식과 카메라 기반 타일/LOD 로딩 방식의 성능 차이를 비교하는 Three.js/R3F PoC입니다.

## STEP to GLB 변환기

`tools/occt-step-to-glb`에 OCCT 기반 STEP -> GLB 변환기 PoC를 추가했습니다.

역할:

- STEP 파일을 `STEPCAFControl_Reader`로 읽기
- BRep 형상을 `BRepMesh_IncrementalMesh`로 삼각형 메시화
- `RWGltf_CafWriter`로 GLB 출력
- 출력된 GLB를 웹뷰어 manifest의 URL로 연결

사용자가 준 샘플 STEP 파일 실행 예시:

```powershell
tools/occt-step-to-glb/build/Release/occt-step-to-glb.exe `
  --input "C:/Users/sni42/Downloads/cargo-ship-5.snapshot.2/cargo ship.STEP" `
  --output "public/models/cargo-ship.glb" `
  --linear-deflection 0.5 `
  --angular-deflection 0.5
```

자세한 빌드 방법은 `tools/occt-step-to-glb/README.md`를 확인하세요.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
