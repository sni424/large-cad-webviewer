import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
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
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
      }}
    >
      <PerspectiveCamera makeDefault position={[70, 52, 86]} fov={55} near={0.1} far={2500} />
      <color attach="background" args={['#10161b']} />
      <SceneLighting />
      <SceneFloor />
      <OrbitControls makeDefault target={[5, 5, 8]} enableDamping dampingFactor={0.08} />
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
  const { scene, camera, gl } = useThree();
  const monitor = useMemo(() => new PerformanceMonitor(), []);
  const managerRef = useRef<TileManager | null>(null);
  const setSnapshot = useViewerStore((state) => state.setSnapshot);
  const setTileRows = useViewerStore((state) => state.setTileRows);

  useEffect(() => {
    const manager = new TileManager(scene, manifest);

    managerRef.current = manager;
    manager.reset(camera);

    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [camera, manifest, scene]);

  useEffect(() => {
    managerRef.current?.setMode(mode, camera);
  }, [camera, mode]);

  useFrame(() => {
    const manager = managerRef.current;

    if (!manager) {
      return;
    }

    const frame = monitor.frame();

    manager.update(camera);
    gl.info.reset();

    // useFrame은 R3F가 실제 render를 호출하기 전에 실행됩니다.
    // 그래서 renderer.info는 직전 프레임 값을 기준으로 UI에 표시됩니다.
    setSnapshot(manager.createSnapshot(gl, frame.fps, frame.frameTimeMs));
    setTileRows(manager.getTileRows());
  });

  return null;
}
