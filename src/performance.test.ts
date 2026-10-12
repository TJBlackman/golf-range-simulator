import { test } from "node:test";
import assert from "node:assert/strict";
import { FrameMetrics } from "./performance.ts";

test("frame metrics distinguish visible cadence from CPU work and discard inactive gaps", () => {
  const metrics = new FrameMetrics();
  metrics.record(100, 1);
  metrics.record(116, 2);
  metrics.record(150, 3);
  assert.deepEqual(metrics.snapshot(), {
    samples: 2,
    frameInterval: { medianMs: 16, p95Ms: 34, maxMs: 34 },
    javascriptAndRenderSubmission: { medianMs: 2, p95Ms: 3, maxMs: 3 },
    framesOverBudget: 1,
  });
  metrics.reset();
  metrics.record(10000, 1);
  metrics.record(10016, 1);
  assert.equal(metrics.snapshot().frameInterval?.maxMs, 16);
});

test("frame metrics retain only the most recent window", () => {
  const metrics = new FrameMetrics();
  metrics.record(100, 90);
  metrics.record(200, 90);
  for (let i = 1; i <= 240; i++) metrics.record(200 + 16 * i, 2);
  assert.equal(metrics.snapshot().samples, 240);
  assert.equal(metrics.snapshot().framesOverBudget, 0);
  assert.equal(metrics.snapshot().frameInterval?.maxMs, 16);
  assert.equal(metrics.snapshot().javascriptAndRenderSubmission?.maxMs, 2);
});
