/** Opt-in frame measurements. Sorting happens only when diagnostics are read. */
export class FrameMetrics {
  private readonly intervals = new Float64Array(240);
  private readonly work = new Float64Array(240);
  private count = 0;
  private cursor = 0;
  private previous = 0;

  reset() {
    this.count = this.cursor = this.previous = 0;
  }

  record(now: number, workMs: number) {
    if (this.previous) {
      this.intervals[this.cursor] = now - this.previous;
      this.work[this.cursor] = workMs;
      this.cursor = (this.cursor + 1) % this.intervals.length;
      this.count = Math.min(this.count + 1, this.intervals.length);
    }
    this.previous = now;
  }

  snapshot() {
    const summary = (values: Float64Array) => {
      if (!this.count) return null;
      const sorted = Array.from(values.subarray(0, this.count)).sort((a, b) => a - b);
      return {
        medianMs: sorted[Math.floor((sorted.length - 1) * 0.5)],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        maxMs: sorted[sorted.length - 1],
      };
    };
    return {
      samples: this.count,
      frameInterval: summary(this.intervals),
      javascriptAndRenderSubmission: summary(this.work),
      framesOverBudget: Array.from(this.intervals.subarray(0, this.count))
        .filter(ms => ms > 1000 / 30 + 0.5).length,
    };
  }
}
