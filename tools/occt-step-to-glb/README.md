# OCCT STEP to GLB Converter

STEP 파일을 OCCT(Open CASCADE Technology)로 읽고, BRep 형상을 삼각형 메시로 테셀레이션한 뒤 GLB로 출력하는 간단한 CLI 변환기입니다.

이 도구는 현재 웹뷰어의 `procedural://` 테스트 모델을 실제 GLB 파일로 교체하기 위한 첫 번째 변환 파이프라인 PoC입니다.

## 역할

- `STEPCAFControl_Reader`로 STEP 파일을 XCAF 문서로 읽습니다.
- `BRepMesh_IncrementalMesh`로 STEP 안의 BRep 형상을 삼각형 메시로 테셀레이션합니다.
- `RWGltf_CafWriter`로 XCAF 문서를 GLB 바이너리 파일로 저장합니다.
- 색상, 이름, assembly tree 등 XCAF에 들어온 기본 구조를 가능한 범위에서 유지합니다.

## 설치

Windows에서 가장 단순한 방법은 Visual Studio C++ Build Tools, CMake, vcpkg를 사용하는 것입니다.

```powershell
git clone https://github.com/microsoft/vcpkg C:\vcpkg
C:\vcpkg\bootstrap-vcpkg.bat
C:\vcpkg\vcpkg.exe install opencascade:x64-windows
```

이미 OCCT를 직접 설치했다면 `OpenCASCADE_DIR`만 CMake에 넘겨도 됩니다.

## 빌드

프로젝트 루트 기준:

```powershell
cmake -S tools/occt-step-to-glb -B tools/occt-step-to-glb/build -DCMAKE_TOOLCHAIN_FILE=C:/vcpkg/scripts/buildsystems/vcpkg.cmake
cmake --build tools/occt-step-to-glb/build --config Release
```

## 실행

사용자가 준 샘플 STEP 파일 기준:

```powershell
tools/occt-step-to-glb/run-converter.bat `
  --input "C:/Users/sni42/Downloads/cargo-ship-5.snapshot.2/cargo ship.STEP" `
  --output "public/models/cargo-ship.glb" `
  --linear-deflection 2.0 `
  --angular-deflection 0.7
```

`run-converter.bat`는 OCCT와 3rd-party DLL 경로를 PATH에 추가한 뒤 변환기를 실행합니다.

현재 샘플 변환 결과:

- 입력 STEP: 약 131MB
- 출력 GLB: 약 17.6MB
- 변환 옵션: `--linear-deflection 2.0 --angular-deflection 0.7`

출력된 GLB는 웹뷰어의 manifest에서 URL만 연결하면 됩니다.

```ts
lods: {
  high: {
    url: "/models/cargo-ship.glb",
    estimatedBytes: 0,
  },
}
```

## 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `--input` | 필수 | 입력 STEP 파일 경로 |
| `--output` | 필수 | 출력 GLB 파일 경로 |
| `--linear-deflection` | `0.5` | 작을수록 더 촘촘한 메시, 더 큰 파일 |
| `--angular-deflection` | `0.5` | 작을수록 곡면 품질 증가, 더 큰 파일 |
| `--relative` | `true` | OCCT 상대 deflection 사용 여부 |

## 주의점

- STEP을 GLB로 바꾸는 과정은 원본 CAD의 BRep/NURBS 정확도를 삼각형 mesh로 근사하는 작업입니다.
- 131MB STEP도 형상 복잡도에 따라 변환 시간이 오래 걸릴 수 있습니다.
- 너무 작은 deflection 값은 GLB 용량과 삼각형 수를 크게 늘립니다.
- 조선 CAD 실무에서는 이 변환기를 바로 제품화하기보다 job queue, cache, LOD 분할, Draco/Meshopt 압축을 붙여야 합니다.
