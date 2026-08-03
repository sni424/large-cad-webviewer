import { Bounds, OrbitControls, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';

interface SingleGlbViewerProps {
  url: string;
}

export function SingleGlbViewer({ url }: SingleGlbViewerProps) {
  return (
    <Canvas
      className="h-full w-full bg-slate-950"
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
        <Bounds fit clip observe margin={1.25}>
          <GlbModel url={url} />
        </Bounds>
      </Suspense>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
    </Canvas>
  );
}

function GlbModel({ url }: SingleGlbViewerProps) {
  const gltf = useGLTF(url);

  return <primitive object={gltf.scene} />;
}

function LoadingMarker() {
  return (
    <mesh position={[0, 2, 0]}>
      <boxGeometry args={[4, 4, 4]} />
      <meshStandardMaterial color="#22d3ee" wireframe />
    </mesh>
  );
}
