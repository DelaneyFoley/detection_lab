import type { RunQueue, RunQueueControl } from "@/lib/services/interfaces";

class InMemoryRunQueue implements RunQueue {
  private controls = new Map<string, RunQueueControl>();

  create(runId: string): RunQueueControl {
    const control: RunQueueControl = { cancelRequested: false };
    this.controls.set(runId, control);
    return control;
  }

  get(runId: string): RunQueueControl | undefined {
    return this.controls.get(runId);
  }

  requestCancel(runId: string): RunQueueControl {
    const existing = this.controls.get(runId) || { cancelRequested: false };
    existing.cancelRequested = true;
    this.controls.set(runId, existing);
    return existing;
  }

  delete(runId: string): void {
    this.controls.delete(runId);
  }
}

export const runQueue: RunQueue = new InMemoryRunQueue();

/**
 * Separate control map for long-running AI prompt-iteration jobs. Uses the same
 * cancel-flag contract as the run queue so orchestration can poll for cancels.
 */
export const iterationJobQueue: RunQueue = new InMemoryRunQueue();

/**
 * Control map for prompt-compare synthesis jobs (analyze several prompts'
 * disagreements → compile one merged prompt). Same cancel-flag contract as the
 * others; separate map so a cancel on synthesis never collides with iteration.
 */
export const compareJobQueue: RunQueue = new InMemoryRunQueue();
