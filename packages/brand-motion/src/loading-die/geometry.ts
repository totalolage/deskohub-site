/**
 * The logo's twenty-sided die as geometry: a true icosahedron, warped with a
 * thin-plate spline so that its rest pose lands on the logo's vertices, drawn
 * as twenty inset triangles with rounded corners.
 *
 * Coordinates are the logo's viewBox units (0 0 289 327, y down). Rotations
 * act in rest-view coordinates: x right, y up, z toward the viewer.
 */

export type Vector3 = readonly [number, number, number];
export type Point = readonly [number, number];
export type Rotation = readonly [Vector3, Vector3, Vector3];

/** A face drawn as one closed Lottie path: six vertices with tangents relative to them. */
export interface FaceOutline {
  /** False when the face is turned away or too thin to draw; the path is then a point. */
  readonly visible: boolean;
  readonly vertices: readonly Point[];
  readonly inTangents: readonly Point[];
  readonly outTangents: readonly Point[];
}

/** Centre of the logo's hexagon. */
export const logoCentre: Point = [144.5, 163];

const faceGap = 4.6;
const cornerRadius = 2.4;
const outerCornerRadius = 7.5;
const hexagonRadius = 108.6;

const logoVertices = {
  top: [144.5, 54.5],
  upperRight: [237.6, 107.5],
  lowerRight: [237.6, 216],
  bottom: [144.5, 271.5],
  lowerLeft: [51.4, 216],
  upperLeft: [51.4, 107.5],
  frontLeft: [111, 114.4],
  frontRight: [178, 114.4],
  frontBottom: [144.5, 216],
} as const satisfies Record<string, Point>;
type LogoVertex = keyof typeof logoVertices;

const subtract = (a: Vector3, b: Vector3): Vector3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const dot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vector3, b: Vector3): Vector3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const sum3 = (a: Vector3, b: Vector3, c: Vector3): Vector3 => [
  a[0] + b[0] + c[0],
  a[1] + b[1] + c[1],
  a[2] + b[2] + c[2],
];
const normalize = (a: Vector3): Vector3 => {
  const length = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / length, a[1] / length, a[2] / length];
};
const distance = (a: Vector3, b: Vector3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = <T>(items: readonly T[], index: number): T => {
  const item = items[index];
  if (item === undefined) {
    throw new RangeError(`No item at index ${index}.`);
  }
  return item;
};

const icosahedronVertices = (): Vector3[] => {
  const phi = (1 + Math.sqrt(5)) / 2;
  const vertices: Vector3[] = [];
  for (const base of [
    [0, 1, phi],
    [1, phi, 0],
    [phi, 0, 1],
  ]) {
    for (const first of [1, -1]) {
      for (const second of [1, -1]) {
        const signs = base.map((value) => (value === 0 ? 0 : 1));
        const nonZero = signs.flatMap((sign, axis) => (sign ? [axis] : []));
        const vertex = [...base];
        vertex[at(nonZero, 0)] = at(vertex, at(nonZero, 0)) * first;
        vertex[at(nonZero, 1)] = at(vertex, at(nonZero, 1)) * second;
        vertices.push([at(vertex, 0), at(vertex, 1), at(vertex, 2)]);
      }
    }
  }
  return vertices;
};

/** Every triple of mutually adjacent vertices, wound counter-clockwise seen from outside. */
const icosahedronFaces = (
  vertices: readonly Vector3[]
): (readonly [number, number, number])[] => {
  const adjacent = (i: number, j: number) =>
    Math.abs(distance(at(vertices, i), at(vertices, j)) - 2) < 1e-6;
  const faces: (readonly [number, number, number])[] = [];
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      for (let k = j + 1; k < 12; k++) {
        if (adjacent(i, j) && adjacent(j, k) && adjacent(i, k)) {
          const a = at(vertices, i);
          const centre = sum3(a, at(vertices, j), at(vertices, k));
          const normal = cross(
            subtract(at(vertices, j), a),
            subtract(at(vertices, k), a)
          );
          faces.push(dot(normal, centre) > 0 ? [i, j, k] : [i, k, j]);
        }
      }
    }
  }
  return faces;
};

const solveLinearSystem = (
  matrix: readonly (readonly number[])[],
  values: readonly number[]
): number[] => {
  const size = values.length;
  const rows = matrix.map((row, index) => [...row, at(values, index)]);
  const cell = (row: number, column: number) => at(at(rows, row), column);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(cell(row, column)) > Math.abs(cell(pivot, column))) {
        pivot = row;
      }
    }
    const swap = at(rows, column);
    rows[column] = at(rows, pivot);
    rows[pivot] = swap;
    for (let row = 0; row < size; row++) {
      if (row !== column) {
        const factor = cell(row, column) / cell(column, column);
        const target = at(rows, row);
        for (let k = column; k <= size; k++) {
          target[k] = at(target, k) - factor * cell(column, k);
        }
      }
    }
  }
  return rows.map((row, index) => at(row, size) / at(row, index));
};

const radialBasis = (squaredDistance: number) =>
  squaredDistance < 1e-12
    ? 0
    : squaredDistance * Math.log(squaredDistance) * 0.5;

const smoothStep = (from: number, to: number, value: number) => {
  const u = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return u * u * (3 - 2 * u);
};

const angleDegrees = (x: number, y: number) =>
  ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;

const buildDie = () => {
  const vertices = icosahedronVertices();
  const faces = icosahedronFaces(vertices);

  // Rest orientation: face 0 toward the viewer, one of its vertices pointing down.
  const [f0, f1, f2] = at(faces, 0);
  const frontNormal = normalize(
    sum3(at(vertices, f0), at(vertices, f1), at(vertices, f2))
  );
  const lowVertex = at(vertices, f0);
  const along = dot(lowVertex, frontNormal);
  const up = normalize(
    subtract(lowVertex, [
      frontNormal[0] * along,
      frontNormal[1] * along,
      frontNormal[2] * along,
    ])
  );
  const ey: Vector3 = [-up[0], -up[1], -up[2]];
  const ez = frontNormal;
  const ex = cross(ey, ez);
  const rest = vertices.map(
    (vertex): Vector3 => [dot(ex, vertex), dot(ey, vertex), dot(ez, vertex)]
  );

  const depths = rest.map((vertex) => vertex[2]).sort((a, b) => b - a);
  const front: number[] = [];
  const back: number[] = [];
  const ring: number[] = [];
  rest.forEach((vertex, index) => {
    if (vertex[2] > at(depths, 3) + 1e-6) {
      front.push(index);
    } else if (vertex[2] < at(depths, 8) - 1e-6) {
      back.push(index);
    } else {
      ring.push(index);
    }
  });
  const ringVertex = at(rest, at(ring, 0));
  const scale = hexagonRadius / Math.hypot(ringVertex[0], ringVertex[1]);
  const [centreX, centreY] = logoCentre;
  const project = (vertex: Vector3): Point => [
    centreX + scale * vertex[0],
    centreY - scale * vertex[1],
  ];

  const nearestLogoVertex = (index: number, names: readonly LogoVertex[]) => {
    const vertex = at(rest, index);
    const angle = angleDegrees(vertex[0], vertex[1]);
    let best: LogoVertex = at(names, 0);
    let bestDifference = Number.POSITIVE_INFINITY;
    for (const name of names) {
      const [x, y] = logoVertices[name];
      const difference = Math.abs(
        angleDegrees(x - centreX, -(y - centreY)) - angle
      );
      const wrapped = Math.min(difference, 360 - difference);
      if (wrapped < bestDifference) {
        bestDifference = wrapped;
        best = name;
      }
    }
    return best;
  };
  const ringNames: Record<number, LogoVertex> = {
    90: "top",
    30: "upperRight",
    330: "lowerRight",
    270: "bottom",
    210: "lowerLeft",
    150: "upperLeft",
  };

  const controls: Point[] = [];
  const targets: Point[] = [];
  const frontNames = new Map<number, LogoVertex>();
  for (const index of front) {
    const name = nearestLogoVertex(index, [
      "frontLeft",
      "frontRight",
      "frontBottom",
    ]);
    frontNames.set(index, name);
    controls.push(project(at(rest, index)));
    targets.push(logoVertices[name]);
  }
  for (const index of ring) {
    const vertex = at(rest, index);
    const sector =
      (Math.round(angleDegrees(vertex[0], vertex[1]) / 30) * 30) % 360;
    const name = ringNames[sector];
    if (name === undefined) {
      throw new Error(`No logo vertex at ${sector} degrees.`);
    }
    controls.push(project(vertex));
    targets.push(logoVertices[name]);
  }
  // Back vertices go where a point-symmetric logo would put them: opposite the front triangle.
  for (const index of back) {
    const point = project(at(rest, index));
    controls.push(point);
    let opposite = at(front, 0);
    let oppositeDistance = Number.POSITIVE_INFINITY;
    for (const candidate of front) {
      const q = project(at(rest, candidate));
      const gap = Math.hypot(
        q[0] + point[0] - 2 * centreX,
        q[1] + point[1] - 2 * centreY
      );
      if (gap < oppositeDistance) {
        oppositeDistance = gap;
        opposite = candidate;
      }
    }
    const name = frontNames.get(opposite);
    if (name === undefined) {
      throw new Error("The back vertex has no front vertex opposite it.");
    }
    const [x, y] = logoVertices[name];
    targets.push([2 * centreX - x, 2 * centreY - y]);
  }

  // Thin-plate spline through the twelve control points.
  const count = controls.length;
  const system = Array.from({ length: count + 3 }, () =>
    Array.from({ length: count + 3 }, () => 0)
  );
  controls.forEach(([x, y], row) => {
    const line = at(system, row);
    controls.forEach(([u, v], column) => {
      line[column] = radialBasis((x - u) ** 2 + (y - v) ** 2);
    });
    line[count] = 1;
    line[count + 1] = x;
    line[count + 2] = y;
    at(system, count)[row] = 1;
    at(system, count + 1)[row] = x;
    at(system, count + 2)[row] = y;
  });
  const affinePadding = [0, 0, 0];
  const weightsX = solveLinearSystem(system, [
    ...targets.map((target) => target[0]),
    ...affinePadding,
  ]);
  const weightsY = solveLinearSystem(system, [
    ...targets.map((target) => target[1]),
    ...affinePadding,
  ]);
  const warp = ([x, y]: Point): Point => {
    let warpedX =
      at(weightsX, count) +
      at(weightsX, count + 1) * x +
      at(weightsX, count + 2) * y;
    let warpedY =
      at(weightsY, count) +
      at(weightsY, count + 1) * x +
      at(weightsY, count + 2) * y;
    controls.forEach(([u, v], index) => {
      const basis = radialBasis((x - u) ** 2 + (y - v) ** 2);
      warpedX += at(weightsX, index) * basis;
      warpedY += at(weightsY, index) * basis;
    });
    return [warpedX, warpedY];
  };

  return { faces, rest, project, warp };
};

const die = buildDie();

/** Unit axes through each of the die's twelve vertices, in rest-view coordinates. */
export const vertexAxes: readonly Vector3[] = die.rest.map(normalize);

/** Rotation by `degrees` about `axis` (right-handed). */
export const axisRotation = (axis: Vector3, degrees: number): Rotation => {
  const [x, y, z] = normalize(axis);
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [c + x * x * t, x * y * t - z * s, x * z * t + y * s],
    [y * x * t + z * s, c + y * y * t, y * z * t - x * s],
    [z * x * t - y * s, z * y * t + x * s, c + z * z * t],
  ];
};

/** The rotation `a` applied after `b`. */
export const composeRotations = (a: Rotation, b: Rotation): Rotation => {
  const columns: Rotation = [
    [b[0][0], b[1][0], b[2][0]],
    [b[0][1], b[1][1], b[2][1]],
    [b[0][2], b[1][2], b[2][2]],
  ];
  return [
    [dot(a[0], columns[0]), dot(a[0], columns[1]), dot(a[0], columns[2])],
    [dot(a[1], columns[0]), dot(a[1], columns[1]), dot(a[1], columns[2])],
    [dot(a[2], columns[0]), dot(a[2], columns[1]), dot(a[2], columns[2])],
  ];
};

const rotate = (rotation: Rotation, vertex: Vector3): Vector3 => [
  dot(rotation[0], vertex),
  dot(rotation[1], vertex),
  dot(rotation[2], vertex),
];

const zero: Point = [0, 0];

const collapsedFace = (point: Point): FaceOutline => ({
  visible: false,
  vertices: Array.from({ length: 6 }, () => point),
  inTangents: Array.from({ length: 6 }, () => zero),
  outTangents: Array.from({ length: 6 }, () => zero),
});

const incentre = (triangle: readonly [Point, Point, Point]) => {
  const [p0, p1, p2] = triangle;
  const a = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
  const b = Math.hypot(p0[0] - p2[0], p0[1] - p2[1]);
  const c = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]);
  const perimeter = a + b + c;
  const area =
    Math.abs(
      (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])
    ) / 2;
  const centre: Point = [
    (a * p0[0] + b * p1[0] + c * p2[0]) / perimeter,
    (a * p0[1] + b * p1[1] + c * p2[1]) / perimeter,
  ];
  return { centre, inradius: (2 * area) / perimeter };
};

/**
 * The triangle inset by `faceGap` (scaled about its incentre), each corner
 * filleted; corners near the hexagon's rim get the logo's larger rounding.
 * Path order: b0, a1, b1, a2, b2, a0, where corner i's fillet runs from a_i
 * (on the edge toward the previous corner) to b_i (toward the next).
 */
const roundedFace = (triangle: readonly [Point, Point, Point]): FaceOutline => {
  const { centre, inradius } = incentre(triangle);
  if (inradius <= faceGap + 0.05) {
    return collapsedFace(centre);
  }
  const shrink = (inradius - faceGap) / inradius;
  const inset = triangle.map(
    ([x, y]): Point => [
      centre[0] + (x - centre[0]) * shrink,
      centre[1] + (y - centre[1]) * shrink,
    ]
  );
  const radius = Math.min(cornerRadius, (inradius - faceGap) * 0.9);
  const corners = inset.map((corner, index) => {
    const previous = at(inset, (index + 2) % 3);
    const next = at(inset, (index + 1) % 3);
    const toPrevious = [
      previous[0] - corner[0],
      previous[1] - corner[1],
    ] as const;
    const previousLength = Math.hypot(...toPrevious);
    const u1 = [
      toPrevious[0] / previousLength,
      toPrevious[1] / previousLength,
    ] as const;
    const toNext = [next[0] - corner[0], next[1] - corner[1]] as const;
    const nextLength = Math.hypot(...toNext);
    const u2 = [toNext[0] / nextLength, toNext[1] / nextLength] as const;
    const angle = Math.acos(
      Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1]))
    );
    const rim = at(triangle, index);
    const rimDistance =
      Math.hypot(rim[0] - logoCentre[0], (rim[1] - logoCentre[1]) * 0.93) /
      hexagonRadius;
    const extra =
      outerCornerRadius *
      smoothStep(0.86, 0.97, rimDistance) *
      smoothStep(65, 88, (angle * 180) / Math.PI);
    const reach = Math.min(
      (radius + extra) / Math.tan(angle / 2),
      0.49 * Math.min(previousLength, nextLength)
    );
    const handle =
      (4 / 3) * Math.tan((Math.PI - angle) / 4) * reach * Math.tan(angle / 2);
    return {
      a: [corner[0] + u1[0] * reach, corner[1] + u1[1] * reach] as Point,
      aHandle: [-u1[0] * handle, -u1[1] * handle] as Point,
      b: [corner[0] + u2[0] * reach, corner[1] + u2[1] * reach] as Point,
      bHandle: [-u2[0] * handle, -u2[1] * handle] as Point,
    };
  });
  const [c0, c1, c2] = [at(corners, 0), at(corners, 1), at(corners, 2)];
  return {
    visible: true,
    vertices: [c0.b, c1.a, c1.b, c2.a, c2.b, c0.a],
    inTangents: [c0.bHandle, zero, c1.bHandle, zero, c2.bHandle, zero],
    outTangents: [zero, c1.aHandle, zero, c2.aHandle, zero, c0.aHandle],
  };
};

/** The twenty faces, in a fixed order, for the die turned by `rotation`. */
export const dieFaces = (rotation: Rotation): readonly FaceOutline[] => {
  const turned = die.rest.map((vertex) => rotate(rotation, vertex));
  const drawn = turned.map((vertex) => die.warp(die.project(vertex)));
  return die.faces.map(([i, j, k]) => {
    const a = at(turned, i);
    const facing = cross(
      subtract(at(turned, j), a),
      subtract(at(turned, k), a)
    );
    const triangle = [at(drawn, i), at(drawn, j), at(drawn, k)] as const;
    return facing[2] > 1e-4
      ? roundedFace(triangle)
      : collapsedFace(incentre(triangle).centre);
  });
};
