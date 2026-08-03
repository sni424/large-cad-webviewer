import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { CadManifest, LoadMode } from './types';
import { TileManager } from './core/TileManager';
import { PerformanceMonitor } from './core/PerformanceMonitor';
import { useViewerStore } from './store/viewerStore';

interface ViewerCanvasProps {
  manifest: CadManifest;
  mode: LoadMode;
}

// 타일 기반 뷰어 전용 Canvas입니다.
// React Three Fiber는 render loop와 카메라/renderer 생명주기를 관리하고,
// 실제 CAD 타일 로딩 전략은 아래 TileRuntimeBridge가 TileManager에 위임합니다.
export function ViewerCanvas({ manifest, mode }: ViewerCanvasProps) {
  return (
    <Canvas
      className="h-full w-full touch-none bg-slate-950"
      dpr={[1, 1.5]}
      gl={{
        // CAD PoC에서는 선명한 MSAA보다 프레임 안정성이 중요해서 antialias를 끕니다.
        antialias: false,
        powerPreference: 'high-performance',
      }}
    >
      <PerspectiveCamera makeDefault position={[70, 52, 86]} fov={55} near={0.1} far={2500} />
      <color attach="background" args={['#10161b']} />
      <SceneLighting />
      <SceneFloor />
      <TileRuntimeBridge manifest={manifest} mode={mode} />
    </Canvas>
  );
}

// CAD 모델의 금속/플라스틱 재질 색이 너무 죽지 않도록 전체 조명은 강하게 둡니다.
// 실제 제품에서는 HDRI 또는 환경광을 따로 넣는 쪽이 더 자연스럽습니다.
function SceneLighting() {
  return (
    <>
      <hemisphereLight args={['#f6fbff', '#2b3942', 2.2]} />
      <directionalLight position={[60, 90, 40]} intensity={2.8} />
      <directionalLight position={[-70, 45, -50]} color="#9bd8ff" intensity={1.3} />
    </>
  );
}

// 바닥과 grid는 실제 모델 위치/스케일을 감으로 확인하기 위한 기준면입니다.
// 성능 비교 대상은 아니므로 단순 geometry만 사용합니다.
function SceneFloor() {
  return (
    <>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.04}>
        <planeGeometry args={[180, 170]} />
        <meshStandardMaterial color="#172027" roughness={0.88} metalness={0.02} />
      </mesh>
      <gridHelper args={[180, 36, '#48636f', '#26343b']} position-y={0.01} />
      <axesHelper args={[10]} position={[-82, 0.08, -78]} />
    </>
  );
}

// R3F 세계와 직접 작성한 imperative class(TileManager)를 연결하는 어댑터입니다.
// useThree로 scene/camera/renderer를 얻고, 매 프레임 TileManager에 업데이트 신호를 줍니다.
function TileRuntimeBridge({ manifest, mode }: ViewerCanvasProps) {
  const { scene, camera, gl, size } = useThree();
  const monitor = useMemo(() => new PerformanceMonitor(), []);
  const managerRef = useRef<TileManager | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const lastTileUpdateAtRef = useRef(0);
  const setSnapshot = useViewerStore((state) => state.setSnapshot);
  const setTileRows = useViewerStore((state) => state.setTileRows);

  useEffect(() => {
    // manifest가 바뀌면 기존 TileManager를 dispose하고 새 데이터셋으로 다시 만듭니다.
    const manager = new TileManager(scene, manifest);

    managerRef.current = manager;
    manager.setViewportHeight(size.height);
    manager.reset(camera);

    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [camera, manifest, scene, size.height]);

  useEffect(() => {
    managerRef.current?.setViewportHeight(size.height);
  }, [size.height]);

  useEffect(() => {
    managerRef.current?.setMode(mode, camera);
  }, [camera, mode]);

  useEffect(() => {
    // OrbitControls 조작 중에는 high LOD attach를 잠깐 미룹니다.
    // 로딩 완료 직후 scene에 붙는 순간 GPU upload가 발생해서 조작이 끊길 수 있기 때문입니다.
    const controls = controlsRef.current;

    if (!controls) {
      return;
    }

    let idleTimer = window.setTimeout(() => {
      managerRef.current?.setNavigationState(false);
    }, 0);

    const markNavigating = () => {
      window.clearTimeout(idleTimer);
      managerRef.current?.setNavigationState(true);
    };

    const markIdleSoon = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        managerRef.current?.setNavigationState(false);
      }, 180);
    };

    controls.addEventListener('start', markNavigating);
    controls.addEventListener('change', markNavigating);
    controls.addEventListener('end', markIdleSoon);

    return () => {
      window.clearTimeout(idleTimer);
      controls.removeEventListener('start', markNavigating);
      controls.removeEventListener('change', markNavigating);
      controls.removeEventListener('end', markIdleSoon);
    };
  }, []);

  useFrame(() => {
    const manager = managerRef.current;

    if (!manager) {
      return;
    }

    // FPS와 frame time은 매 프레임 계산하되, 타일 판정은 아래에서 100ms마다만 실행합니다.
    const frame = monitor.frame();
    const now = performance.now();

    // 타일 거리 판정과 큐 갱신은 매 프레임 할 필요가 없습니다.
    // 100ms 간격이면 카메라 반응은 충분히 빠르고, 큰 CAD에서 CPU 부하가 훨씬 안정적입니다.
    if (now - lastTileUpdateAtRef.current > 100) {
      manager.setViewportHeight(size.height);
      manager.update(camera);
      lastTileUpdateAtRef.current = now;
    }

    gl.info.reset();

    // useFrame은 R3F가 실제 render를 호출하기 전에 실행됩니다.
    // 그래서 renderer.info는 직전 프레임 값을 기준으로 UI에 표시됩니다.
    setSnapshot(manager.createSnapshot(gl, frame.fps, frame.frameTimeMs));
    setTileRows(manager.getTileRows());
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[5, 5, 8]}
      enableDamping
      dampingFactor={0.08}
    />
  );
}
