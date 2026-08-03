import { Bounds, OrbitControls, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';

interface SingleGlbViewerProps {
  url: string;
}

// 타일링하지 않은 단일 GLB를 그대로 보여주는 비교용 뷰어입니다.
// 이 화면은 LODController/TileManager를 거치지 않기 때문에
// 카메라가 멀어져도 모델이 unload되지 않는 것이 정상입니다.
export function SingleGlbViewer({ url }: SingleGlbViewerProps) {
  return (
    <Canvas
      className="h-full w-full touch-none bg-slate-950"
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
      }}
    >
      <PerspectiveCamera makeDefault position={[90, 55, 120]} fov={50} near={0.1} far={5000} />
      <color attach="background" args={['#10161b']} />
      <hemisphereLight args={['#f6fbff', '#2b3942', 2.2]} />
      <directionalLight position={[80, 120, 60]} intensity={2.5} />
      <directionalLight position={[-80, 50, -70]} color="#9bd8ff" intensity={1.2} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.08}>
        <planeGeometry args={[260, 220]} />
        <meshStandardMaterial color="#172027" roughness={0.9} />
      </mesh>
      <gridHelper args={[260, 52, '#48636f', '#26343b']} position-y={0.01} />
      <axesHelper args={[12]} position={[-118, 0.08, -98]} />
      <Suspense fallback={<LoadingMarker />}>
        {/* Bounds가 단일 GLB의 전체 bounding box에 맞춰 카메라/클리핑을 자동 보정합니다. */}
        <Bounds fit clip observe margin={1.25}>
          <GlbModel url={url} />
        </Bounds>
      </Suspense>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}

// drei의 useGLTF는 내부 캐시를 사용합니다.
// 같은 URL을 다시 열 때 네트워크/파싱 비용이 줄어드는 장점이 있습니다.
function GlbModel({ url }: SingleGlbViewerProps) {
  const gltf = useGLTF(url);

  return <primitive object={gltf.scene} />;
}

// GLB가 아직 로딩되지 않았을 때 표시되는 작은 wireframe placeholder입니다.
function LoadingMarker() {
  return (
    <mesh position={[0, 2, 0]}>
      <boxGeometry args={[4, 4, 4]} />
      <meshStandardMaterial color="#22d3ee" wireframe />
    </mesh>
  );
}
