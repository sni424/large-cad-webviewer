// 렌더 루프에서 FPS와 프레임 시간을 계산하는 작은 도구입니다.
// Three.js 렌더링 정보(draw calls, triangles)는 renderer.info에서 따로 읽습니다.
export class PerformanceMonitor {
  private lastTime = performance.now();
  private frameCount = 0;
  private elapsedMs = 0;
  private fps = 0;
  private frameTimeMs = 0;

  frame(now = performance.now()): { fps: number; frameTimeMs: number } {
    const deltaMs = now - this.lastTime;

    this.lastTime = now;
    this.frameTimeMs = deltaMs;
    this.frameCount += 1;
    this.elapsedMs += deltaMs;

    // 매 프레임 FPS를 흔들리게 표시하지 않기 위해 0.5초 단위로 갱신합니다.
    if (this.elapsedMs >= 500) {
      this.fps = (this.frameCount * 1000) / this.elapsedMs;
      this.frameCount = 0;
      this.elapsedMs = 0;
    }

    return {
      fps: this.fps,
      frameTimeMs: this.frameTimeMs,
    };
  }
}
