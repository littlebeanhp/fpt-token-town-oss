import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry, Color, Matrix4, MeshStandardMaterial } from 'three/webgpu';
import {
  CITY_MINUTES_PER_SECOND,
  CLOCK_SPEEDS,
  PRESET_HOURS,
  formatClock,
  hoursUntil,
  nextSpeed,
  phaseAt,
} from '../src/data/clock';
import { CityClock, createLightingSample, sampleLighting } from '../src/experience/world/CityClock';
import { BACKGROUND_EMPHASIS } from '../src/experience/core/emphasis';
import { TintedInstances } from '../src/experience/core/TintedInstances';

test('the city clock advances by speed, pauses, and wraps past midnight', () => {
  const clock = new CityClock(23.5);
  clock.speed = 4;
  clock.advance(60);
  const expected = (23.5 + (60 * 4 * CITY_MINUTES_PER_SECOND) / 60) % 24;
  assert.ok(Math.abs(clock.hours - expected) < 1e-9);
  assert.ok(clock.hours < 24);
  clock.paused = true;
  const held = clock.hours;
  clock.advance(10);
  assert.equal(clock.hours, held, 'a paused clock holds its time');
  assert.equal(new CityClock(12, true).paused, true, 'reduced motion can start paused');
});

test('presets always move forward and speeds cycle', () => {
  assert.equal(hoursUntil(23, PRESET_HOURS.day), 13);
  assert.equal(hoursUntil(11, PRESET_HOURS.day), 1);
  assert.equal(formatClock(18.25), '18:15');
  assert.equal(formatClock(24.5), '00:30');
  assert.deepEqual(
    CLOCK_SPEEDS.map((speed) => nextSpeed(speed)),
    [...CLOCK_SPEEDS.slice(1), CLOCK_SPEEDS[0]],
  );
  for (const [preset, hours] of Object.entries(PRESET_HOURS)) assert.equal(phaseAt(hours), preset);
});

test('lighting runs day to dusk to night without visible jumps', () => {
  const sample = createLightingSample();
  sampleLighting(12, sample);
  assert.ok(sample.night < 0.01, 'noon is day');
  assert.ok(sample.lightIntensity > 3, 'noon sun is strong');
  sampleLighting(22, sample);
  assert.ok(sample.night > 0.99, '22:00 is night');
  assert.ok(sample.lightIntensity < 1, 'moonlight is soft');
  sampleLighting(18.25, sample);
  assert.ok(sample.night > 0.3 && sample.night < 0.95, 'dusk is a transition');

  const previous = createLightingSample();
  sampleLighting(0, previous);
  for (let minute = 1; minute <= 24 * 60; minute++) {
    sampleLighting(minute / 60, sample);
    const angle = sample.lightDirection.angleTo(previous.lightDirection);
    assert.ok(angle < 0.01, `light direction jumps ${angle.toFixed(4)} rad at minute ${minute}`);
    assert.ok(sample.lightDirection.y > 0.25, 'the key light never drops below the city');
    assert.ok(Math.abs(sample.lightIntensity - previous.lightIntensity) < 0.08);
    assert.ok(Math.abs(sample.night - previous.night) < 0.03);
    assert.ok(Math.abs(sample.hemiIntensity - previous.hemiIntensity) < 0.05);
    for (const channel of ['r', 'g', 'b'] as const)
      assert.ok(Math.abs(sample.sky[channel] - previous.sky[channel]) < 0.03);
    previous.lightDirection.copy(sample.lightDirection);
    previous.lightIntensity = sample.lightIntensity;
    previous.night = sample.night;
    previous.hemiIntensity = sample.hemiIntensity;
    previous.sky.copy(sample.sky);
  }
});

test('background instances turn gray while the focused block keeps its colors', () => {
  const geometry = new BoxGeometry(),
    material = new MeshStandardMaterial();
  const batch = new TintedInstances(geometry, material, 2);
  const red = new Color('#e05d5d');
  batch.add(new Matrix4(), red, 1);
  batch.add(new Matrix4(), red, 2);
  batch.applyEmphasis((key) => (key === 1 ? 1 : BACKGROUND_EMPHASIS));
  const colors = batch.mesh.instanceColor!.array;
  // Colors are stored as float32, so compare within float precision.
  [red.r, red.g, red.b].forEach((value, channel) =>
    assert.ok(Math.abs(colors[channel] - value) < 1e-6, 'focused block keeps its color'),
  );
  const [r, g, b] = [colors[3], colors[4], colors[5]];
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 0.02, 'background is gray');
  assert.equal(batch.mesh.material, material);
  batch.dispose();
  geometry.dispose();
  material.dispose();
});
