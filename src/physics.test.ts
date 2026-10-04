import { test } from "node:test";
import assert from "node:assert/strict";
import { CLUBS, TEE, simulateShot, sampleShot } from "./physics.ts";

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
