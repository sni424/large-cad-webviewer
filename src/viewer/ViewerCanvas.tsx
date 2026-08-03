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

export function ViewerCanvas({ manifest, mode }: ViewerCanvasProps) {
  return (
    <Canvas
      className="h-full w-full bg-slate-950"
      dpr={[1, 1.5]}
      gl={{
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

function SceneLighting() {
  return (
    <>
      <hemisphereLight args={['#f6fbff', '#2b3942', 2.2]} />
      <directionalLight position={[60, 90, 40]} intensity={2.8} />
      <directionalLight position={[-70, 45, -50]} color="#9bd8ff" intensity={1.3} />
    </>
  );
}

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

function TileRuntimeBridge({ manifest, mode }: ViewerCanvasProps) {
  const { scene, camera, gl, size } = useThree();
  const monitor = useMemo(() => new PerformanceMonitor(), []);
  const managerRef = useRef<TileManager | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const lastTileUpdateAtRef = useRef(0);
  const setSnapshot = useViewerStore((state) => state.setSnapshot);
  const setTileRows = useViewerStore((state) => state.setTileRows);

  useEffect(() => {
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
