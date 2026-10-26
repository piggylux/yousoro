import { describe, expect, it } from 'vitest';

import {
  angleBetween,
  highlightOn,
  axisAngle,
  IDENTITY,
  inverse,
  multiply,
  rotateVector,
  tiltOf,
  toAxisAngle,
  toCss,
  type Rotation,
} from '#lib/card-rotation.js';

const expectClose = (actual: Rotation, expected: Rotation) =>
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 6));

describe('axisAngle', () => {
  it("matches CSS's rotateY, which turns the right edge away from the viewer", () => {
    // rotateY(90deg) takes the x axis to -z, away from the viewer
    const rotation = axisAngle(0, 1, 0, 90);
    expectClose(rotation, [0, 0, 1, 0, 1, 0, -1, 0, 0]);
  });

  it('is the identity for no turn or no axis', () => {
    expect(axisAngle(0, 1, 0, 0)).toBe(IDENTITY);
    expect(axisAngle(0, 0, 0, 90)).toBe(IDENTITY);
  });
});

describe('toAxisAngle', () => {
  it.each([
    [0, 1, 0, 50],
    [-1, 0, 0, 70],
    [0.6, 0.8, 0, 130],
    [0, 1, 0, 180],
    [0.6, 0.8, 0, 180],
    [0.3, -0.5, 0.81, 160],
  ])('gives back the rotation about (%f, %f, %f) by %f degrees', (x, y, z, degrees) => {
    const rotation = axisAngle(x, y, z, degrees);
    const found = toAxisAngle(rotation);
    expectClose(axisAngle(found.x, found.y, found.z, found.degrees), rotation);
  });

  it('turns the long way round into the short way', () => {
    expect(toAxisAngle(axisAngle(0, 1, 0, 270)).degrees).toBeCloseTo(90);
  });
});

describe('multiply and inverse', () => {
  it('adds turns about the same axis', () => {
    expectClose(multiply(axisAngle(0, 1, 0, 30), axisAngle(0, 1, 0, 60)), axisAngle(0, 1, 0, 90));
  });

  it('undoes a rotation', () => {
    const rotation = axisAngle(0.3, -0.5, 0.81, 123);
    expectClose(multiply(rotation, inverse(rotation)), IDENTITY);
  });

  it('measures the shortest turn between two orientations', () => {
    expect(angleBetween(axisAngle(1, 0, 0, 170), axisAngle(1, 0, 0, -170))).toBeCloseTo(20);
  });
});

describe('tiltOf', () => {
  it('is flat facing the viewer at rest', () => {
    expect(tiltOf(IDENTITY).degrees).toBeCloseTo(0);
  });

  it('reads a turn about an axis in the card plane back as that turn', () => {
    const direction = Math.PI * 0.7;
    const tilt = tiltOf(axisAngle(Math.cos(direction), Math.sin(direction), 0, 120));
    expect(tilt.degrees).toBeCloseTo(120);
    expect(tilt.direction).toBeCloseTo(direction);
  });

  it('ignores a spin in the card plane', () => {
    expect(tiltOf(axisAngle(0, 0, 1, 90)).degrees).toBeCloseTo(0);
  });
});

describe('rotateVector', () => {
  it('turns a direction the way the rotation does', () => {
    const [x, y, z] = rotateVector(axisAngle(0, 1, 0, 90), [1, 0, 0]);
    expect([x, y, z].map((value) => Math.round(value))).toEqual([0, 0, -1]);
  });
});

describe('highlightOn', () => {
  it('shines toward the top left of a face lying flat, where the light is', () => {
    const highlight = highlightOn(IDENTITY);
    expect(highlight.x).toBeLessThan(0);
    expect(highlight.y).toBeLessThan(0);
    expect(highlight.strength).toBeGreaterThan(0.7);
  });

  it('slides across the face as it turns toward the light', () => {
    const flat = highlightOn(IDENTITY);
    // Turning the left edge a little away tips the face toward the light on the left
    const turned = highlightOn(axisAngle(0, 1, 0, -10));
    expect(turned.x).toBeGreaterThan(flat.x);
    expect(turned.strength).toBeGreaterThan(flat.strength);
  });

  it('stays bright well into a tilt, then goes dark facing away from the light', () => {
    expect(highlightOn(axisAngle(0, 1, 0, 50)).strength).toBeGreaterThan(0.3);
    expect(highlightOn(axisAngle(0, 1, 0, 130)).strength).toBe(0);
  });
});

describe('toCss', () => {
  it('lists the values column by column', () => {
    expect(toCss([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBe(
      'matrix3d(1, 4, 7, 0, 2, 5, 8, 0, 3, 6, 9, 0, 0, 0, 0, 1)'
    );
  });
});
