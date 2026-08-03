import type { QueueJob, QueueStats } from '../types';

// GLB 같은 큰 파일을 동시에 너무 많이 요청하지 않도록 제한하는 큐입니다.
// 대용량 CAD에서는 "무엇을 로딩할지"만큼 "몇 개를 동시에 로딩할지"도 중요합니다.
export class LoadQueue {
  // 아직 시작하지 않은 작업입니다.
  private readonly pending = new Map<string, QueueJob>();

  // 현재 실행 중인 작업 key만 저장합니다.
  private readonly active = new Set<string>();

  // erasableSyntaxOnly 옵션 때문에 constructor parameter property를 쓰지 않습니다.
  private readonly maxConcurrent: number;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  // 새 로딩 작업을 큐에 넣습니다.
  // 같은 key가 이미 대기/실행 중이면 중복으로 넣지 않습니다.
  enqueue(job: QueueJob): void {
    if (this.pending.has(job.key) || this.active.has(job.key)) {
      return;
    }

    this.pending.set(job.key, job);
    this.pump();
  }

  // 아직 시작하지 않은 작업 중 조건에 맞는 작업을 취소합니다.
  // 예: 카메라가 멀어져서 더 이상 필요 없는 타일 로딩 취소
  cancel(predicate: (job: QueueJob) => boolean): void {
    for (const [key, job] of this.pending) {
      if (predicate(job)) {
        this.pending.delete(key);
      }
    }
  }

  // 모드 전환이나 전체 reset 때 대기열을 비웁니다.
  clear(): void {
    this.pending.clear();
  }

  // 성능 패널에서 queued/loading 개수를 보여주기 위한 값입니다.
  getStats(): QueueStats {
    return {
      queued: this.pending.size,
      loading: this.active.size,
      maxConcurrent: this.maxConcurrent,
    };
  }

  // 빈 슬롯이 있으면 우선순위가 높은 작업부터 실행합니다.
  private pump(): void {
    while (this.active.size < this.maxConcurrent && this.pending.size > 0) {
      const job = this.getNextJob();

      if (!job) {
        return;
      }

      this.pending.delete(job.key);
      this.active.add(job.key);

      // run()은 실제 GLB fetch/parse 또는 proxy 생성 작업입니다.
      // 완료/실패 처리는 TileManager가 넘겨준 callback에서 타일 상태와 scene attach를 정리합니다.
      job
        .run()
        .then(job.onComplete)
        .catch(job.onError)
        .finally(() => {
          // 하나가 끝나면 다음 대기 작업을 바로 시작합니다.
          this.active.delete(job.key);
          this.pump();
        });
    }
  }

  // priority 숫자가 낮은 작업이 더 중요합니다.
  // TileManager가 카메라와 가까운 타일에 낮은 priority를 주게 됩니다.
  private getNextJob(): QueueJob | null {
    let selectedJob: QueueJob | null = null;

    for (const job of this.pending.values()) {
      if (!selectedJob || job.priority < selectedJob.priority) {
        selectedJob = job;
      }
    }

    return selectedJob;
  }
}
