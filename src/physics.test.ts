import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CLUBS, TEE, simulateShot, simulateShotSummary, sampleShot } from "./physics.ts";
import type { Shape } from "./physics.ts";

test("each club reaches its advertised carry in calm conditions", () => {
  for (const club of CLUBS) {
    const shot = simulateShot({
      club,
      power: 1,
      aim: 0,
      shape: "straight",
      wind: 0,
    });
    assert.ok(
      Math.abs(shot.carry - club.carry) < 0.2,
      `${club.name}: ${shot.carry}`,
    );
    assert.ok(shot.total >= shot.carry);
    assert.ok(shot.end.y >= 0);
    assert.ok(shot.duration < 20);
  }
});

test("reduced power shortens distance, aim turns shots, and wind moves the ball", () => {
  const options = {
    club: CLUBS[2],
    power: 1,
    aim: 0,
    shape: "straight" as const,
    wind: 0,
  };
  const full = simulateShot(options);
  assert.ok(simulateShot({ ...options, power: 0.5 }).carry < full.carry * 0.7);
  assert.ok(simulateShot({ ...options, aim: 15 }).end.x < -20);
  assert.ok(simulateShot({ ...options, aim: -15 }).end.x > 20);
  assert.ok(simulateShot({ ...options, wind: 3 }).end.x < full.end.x);
  assert.ok(simulateShot({ ...options, shape: "draw" }).end.x > full.end.x);
  assert.ok(simulateShot({ ...options, shape: "fade" }).end.x < full.end.x);
});

test("trajectory sampling starts at the tee, interpolates, and settles at the endpoint", () => {
  const shot = simulateShot({
    club: CLUBS[0],
    power: 0.6,
    aim: 0,
    shape: "straight",
    wind: 0,
  });
  assert.deepEqual(sampleShot(shot, 0), TEE);
  assert.ok(sampleShot(shot, 0.3).y > TEE.y);
  assert.deepEqual(sampleShot(shot, shot.duration + 1), shot.end);
});

test("golfer shots originate at their own bay and negative sampling stays at launch", () => {
  const options = {
    club: CLUBS[1],
    power: 0.8,
    aim: 8,
    shape: "straight" as const,
    wind: 0,
  };
  const origin = { x: -11.54, y: TEE.y, z: TEE.z };
  const tee = simulateShot(options),
    bay = simulateShot(options, origin);
  assert.deepEqual(sampleShot(bay, -1), origin);
  assert.ok(Math.abs(bay.end.x - tee.end.x - (origin.x - TEE.x)) < 1e-6);
  assert.ok(Math.abs(bay.total - tee.total) < 1e-6);
});

test("distance probes exactly match sampled shots for every club and shot shape", () => {
  const origin = { x: -11.54, y: TEE.y, z: TEE.z };
  const shapes: Shape[] = ["straight", "draw", "fade"];
  for (const club of CLUBS) {
    for (const power of [0.05, 0.5, 1]) {
      for (const [index, shape] of shapes.entries()) {
        const options = { club, power, aim: (index - 1) * 23, shape, wind: (index - 1) * 4 };
        const { points, ...expected } = simulateShot(options, origin);
        const summary = simulateShotSummary(options, origin);
        assert.deepEqual(summary, expected);
        assert.equal(Object.hasOwn(summary, "points"), false);
        assert.ok(points.length > 1);
      }
    }
  }
});

test("optimized integration preserves the complete original sampled trajectories", () => {
  // Golden hashes were captured before adding summary probes and carry-only calibration.
  const fixtures = [
    { options: { club: CLUBS[0], power: 0.6, aim: 0, shape: "straight" as const, wind: 0 },
      origin: TEE, hash: "8055cf05e61bca2d8b28faf3591cc52586a457a49e5fe148bfb0c0ee9e22f28e" },
    { options: { club: CLUBS[2], power: 0.83, aim: 17, shape: "draw" as const, wind: 3.25 },
      origin: { x: -11.54, y: TEE.y, z: TEE.z }, hash: "d291cbf87a6a0d015dccd156a3e3d30f8885a3f1895d5cee278ab76d2403da3c" },
    { options: { club: CLUBS[4], power: 1, aim: -28, shape: "fade" as const, wind: -4 },
      origin: TEE, hash: "ea97b94307dae9d51dab67378c5c75086a67d1109961c8760e732dc31ab80f08" },
  ];
  for (const { options, origin, hash } of fixtures) {
    const shot = simulateShot(options, origin);
    assert.equal(createHash("sha256").update(JSON.stringify(shot.points)).digest("hex"), hash);
  }
});

test("speed calibration follows carry and loft while roll only affects distance after landing", () => {
  const club = { ...CLUBS[2], id: "custom" };
  const options = { club, power: 1, aim: 0, shape: "straight" as const, wind: 0 };
  const baseline = simulateShotSummary(options);
  const differentRoll = simulateShotSummary({ ...options, club: { ...club, id: "alias", roll: 0.5 } });
  assert.equal(differentRoll.speed, baseline.speed);
  assert.equal(differentRoll.carry, baseline.carry);
  assert.ok(differentRoll.total > baseline.total);
  for (const variant of [{ ...club, carry: 165 }, { ...club, loft: 38 }]) {
    const shot = simulateShotSummary({ ...options, club: variant });
    assert.ok(Math.abs(shot.carry - variant.carry) < 0.2);
    assert.notEqual(shot.speed, baseline.speed);
  }
});

test("trajectory sampling can reuse an output point without changing its default fresh-result contract", () => {
  const shot = simulateShot({ club: CLUBS[2], power: 1, aim: 12, shape: "draw", wind: 2 });
  const out = { x: 0, y: 0, z: 0 };
  const previous = sampleShot(shot, 0.3);
  const previousSnapshot = { ...previous };
  for (const time of [-1, 0, 0.3, 0.61, shot.duration + 1]) {
    const expected = sampleShot(shot, time);
    assert.equal(sampleShot(shot, time, out), out);
    assert.deepEqual(out, expected);
    assert.notEqual(expected, out);
    assert.notEqual(sampleShot(shot, time), expected);
  }
  assert.deepEqual(previous, previousSnapshot);
});
