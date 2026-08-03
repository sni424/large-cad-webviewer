# large-cad-webviewer

STEP → GLB 변환 (OCCT/C++) + Three.js 웹 뷰어

## 작업 방식 (중요)
- 요청받은 코드 수정만 하고 종료한다. 빌드/실행/검증은 사용자가 직접 한다.
- "빌드해서 확인해줘"라고 명시할 때만 빌드한다.
- 계획 설명 없이 바로 수정한다.
- 파일 경로가 주어지면 그 파일만 읽는다. 주변 탐색 금지.

## Bash 규칙
- 모든 명령에 `timeout 120` 접두.
- `find /` 절대 금지. 파일 검색은 `rg --files -g` 또는 `fd`만 사용.
- 명령이 2분 넘게 걸릴 것 같으면 실행하지 말고 사용자에게 묻는다.

## 경로
- 변환기: tools/occt-step-to-glb/main.cpp
- 뷰어: src/
- OCCT 헤더: C:\opencascade-8.0.1-vc14-64-combined\opencascade-8.0.1-vc14-64\inc
- 대용량 파일: public/models/*.glb, public/cad/*.STEP → 읽지 말 것

## 테스트
- 로직 검증은 test/mini.STEP 사용 (component 4개, 수 초).
- cargo ship.STEP은 최종 검증 1회만. 중간 확인에 쓰지 말 것.
- 출력 폴더는 scratch/ 하나만 사용. scratch-test-components2,3,4... 새로 만들지 말 것.