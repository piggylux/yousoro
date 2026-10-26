/**
 * A card's 3D orientation as a 3×3 rotation matrix, row by row, in CSS's coordinates: x to the
 * right, y down, z toward the viewer. Rotations compose the way CSS transforms do, so a card
 * dragged a little at a time tumbles freely in any direction.
 */
export type Rotation = readonly number[];

export const IDENTITY: Rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The same rotation as CSS's `rotate3d(x, y, z, degrees)`. */
export function axisAngle(x: number, y: number, z: number, degrees: number): Rotation {
  const length = Math.hypot(x, y, z);
  if (length === 0 || degrees === 0) return IDENTITY;
  [x, y, z] = [x / length, y / length, z / length];
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y - s * z,
    t * x * z + s * y,
    t * x * y + s * z,
    t * y * y + c,
    t * y * z - s * x,
    t * x * z - s * y,
    t * y * z + s * x,
    t * z * z + c,
  ];
}

/** `a` after `b`, as in the CSS transform list `a b`. */
export function multiply(a: Rotation, b: Rotation): Rotation {
  const product: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a[row * 3 + k] * b[k * 3 + column];
      product.push(sum);
    }
  }
  return product;
}

/** The rotation that undoes this one. */
export function inverse(rotation: Rotation): Rotation {
  const [a, b, c, d, e, f, g, h, i] = rotation;
  return [a, d, g, b, e, h, c, f, i];
}

/** The axis and angle, from 0 to 180 degrees, that make up this rotation. */
export function toAxisAngle(rotation: Rotation): {
  x: number;
  y: number;
  z: number;
  degrees: number;
} {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotation;
  const angle = Math.acos(Math.min(1, Math.max(-1, (r00 + r11 + r22 - 1) / 2)));
  const sin = Math.sin(angle);
  const degrees = (angle * 180) / Math.PI;
  if (sin > 1e-4) {
    return {
      x: (r21 - r12) / (2 * sin),
      y: (r02 - r20) / (2 * sin),
      z: (r10 - r01) / (2 * sin),
      degrees,
    };
  }
  if (angle < 1e-4) return { x: 0, y: 0, z: 1, degrees: 0 };
  // A half turn: the axis comes from the diagonal, its signs from the largest component
  let x = Math.sqrt(Math.max(0, (r00 + 1) / 2));
  let y = Math.sqrt(Math.max(0, (r11 + 1) / 2));
  let z = Math.sqrt(Math.max(0, (r22 + 1) / 2));
  if (x > 1e-4) {
    y *= Math.sign(r01) || 1;
    z *= Math.sign(r02) || 1;
  } else if (y > 1e-4) {
    z *= Math.sign(r12) || 1;
  }
  return { x, y, z, degrees };
}

/** How far apart two orientations are, in degrees, the shortest way round. */
export function angleBetween(a: Rotation, b: Rotation): number {
  return toAxisAngle(multiply(a, inverse(b))).degrees;
}

/** A direction, turned by this rotation. */
export function rotateVector(rotation: Rotation, [x, y, z]: readonly number[]): number[] {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotation;
  return [r00 * x + r01 * y + r02 * z, r10 * x + r11 * y + r12 * z, r20 * x + r21 * y + r22 * z];
}

/*
 * A light above and to the left, in front of the screen, and the viewer straight in front: a glossy
 * face shines brightest where it's angled halfway between the two
 */
const LIGHT = [-0.45, -0.6, 1];
const HALFWAY = (() => {
  const light = LIGHT.map((value) => value / Math.hypot(...LIGHT));
  const sum = [light[0], light[1], light[2] + 1];
  return sum.map((value) => value / Math.hypot(...sum));
})();

/**
 * Where the light's highlight sits on a face turned this way, from -0.5 to 0.5 across and down
 * from its center, and how bright it is, from 0 facing away from the light to 1 facing into it.
 */
export function highlightOn(face: Rotation): { x: number; y: number; strength: number } {
  // The halfway direction as the face sees it, in its own coordinates
  const [x, y, z] = rotateVector(inverse(face), HALFWAY);
  const clamp = (value: number) => Math.min(0.5, Math.max(-0.5, value));
  // Glossy rather than mirror-like: it fades gently as the face tips away, out past side-on
  const strength = (Math.max(0, z + 0.35) / 1.35) ** 2;
  return { x: clamp(x * 1.4), y: clamp(y * 1.4), strength };
}

/** A CSS `matrix3d()` for this rotation. */
export function toCss(rotation: Rotation): string {
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotation;
  // matrix3d() takes its values column by column
  return `matrix3d(${r00}, ${r10}, ${r20}, 0, ${r01}, ${r11}, ${r21}, 0, ${r02}, ${r12}, ${r22}, 0, 0, 0, 0, 1)`;
}

/**
 * How far the card's front has turned away from the viewer, from 0 degrees facing them to 180
 * facing away, and which way, clockwise from up, as for a turn about an axis in the card's plane.
 */
export function tiltOf(rotation: Rotation): { degrees: number; direction: number } {
  // Where the front's normal, straight out toward the viewer, now points
  const [, , normalX, , , normalY, , , normalZ] = rotation;
  return {
    degrees: (Math.acos(Math.min(1, Math.max(-1, normalZ))) * 180) / Math.PI,
    direction: Math.atan2(normalX, -normalY),
  };
}
