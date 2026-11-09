import { expect, test } from "bun:test";
import type { Table } from "./generated";
import { TableMap } from "./table-map";

type ReactElementLike = {
  readonly key?: string | null;
  readonly props: {
    readonly "aria-label"?: string;
    readonly children: ReactElementLike | readonly ReactElementLike[];
    readonly className?: string;
    readonly color?: string;
    readonly d?: string;
    readonly fill?: string;
    readonly height?: number;
    readonly onClick?: () => void;
    readonly onKeyDown?: (event: {
      readonly key: string;
      readonly preventDefault: () => void;
    }) => void;
    readonly points?: string;
    readonly role?: string;
    readonly stroke?: string;
    readonly strokeOpacity?: number;
    readonly strokeWidth?: number;
    readonly style?: Record<string, unknown>;
    readonly tabIndex?: number;
    readonly transform?: string;
    readonly viewBox?: string;
    readonly width?: number;
    readonly x?: number;
    readonly x1?: number;
    readonly x2?: number;
    readonly y?: number;
    readonly y1?: number;
    readonly y2?: number;
  };
};

const childrenOf = (element: ReactElementLike) => {
  if (!Array.isArray(element.props.children)) {
    throw new Error("Expected element children array");
  }

  return element.props.children;
};

const firstChild = (element: ReactElementLike) => {
  const child = childrenOf(element)[0];
  if (!child) throw new Error("Expected child element");

  return child;
};

test("renders positioned tables with classes and click handlers", () => {
  const table: Table = {
    _cloudId: "cloud",
    id: "table-1",
    name: "T1",
    positionX: "10",
    positionY: "20",
    type: "CIRCLE2",
  };
  const clicks: Table[] = [];

  const svg = TableMap({
    tables: [table],
    tableLabelStyle: () => "label-selected",
    tableLabelInlineStyle: () => ({ fill: "white" }),
    tableShapeInlineStyle: () => ({ fill: "navy" }),
    tableStyle: () => "is-selected",
    onTableClick: (clickedTable) => clicks.push(clickedTable),
  }) as ReactElementLike;
  const group = firstChild(svg);
  const shapeGroup = group.props.children as ReactElementLike;
  const label = childrenOf(svg)[1];
  if (!label) throw new Error("Expected table label");
  const circle = shapeGroup.props.children as ReactElementLike;

  expect(svg.props.viewBox).toBe("-34 -24 88 88");
  expect(circle.props.className).toBe("is-selected");
  expect(circle.props.style).toEqual({ fill: "navy" });
  expect(label.props.className).toBe("label-selected");
  expect(label.props.style).toEqual({ fill: "white" });
  expect(svg.props.role).toBe("group");
  expect(group.props.role).toBe("button");
  expect(group.props["aria-label"]).toBe("T1");
  expect(group.props.tabIndex).toBe(0);

  group.props.onClick?.();

  expect(clicks).toEqual([table]);
});

test("renders a rectangular room layout behind tables", () => {
  const table: Table = {
    _cloudId: "cloud",
    id: "table-1",
    name: "T1",
  };

  const svg = TableMap({
    tables: [table],
    tableStyle: () => "is-muted",
    roomLayout: {
      x: -100,
      y: -50,
      width: 300,
      height: 200,
      className: "room-outline",
    },
  }) as ReactElementLike;
  const room = firstChild(firstChild(svg));

  expect(svg.props.viewBox).toBe("-120 -70 340 240");
  expect(room.props.className).toBe("room-outline");
  expect(room.props.x).toBe(-100);
  expect(room.props.y).toBe(-50);
  expect(room.props.width).toBe(300);
  expect(room.props.height).toBe(200);
});

test("renders a bottom entrance door with a right hinge and arrow", () => {
  const svg = TableMap({
    tables: [],
    tableStyle: () => "is-muted",
    roomLayout: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      doors: [
        {
          wall: "bottom",
          offset: 10,
          width: 30,
          showEntranceArrow: true,
        },
      ],
    },
  }) as ReactElementLike;
  const roomGroup = firstChild(svg);
  const doorGroup = childrenOf(roomGroup)[1];
  if (!doorGroup) throw new Error("Expected door group");
  const [opening, doorLeaf, swing, arrow] = childrenOf(doorGroup);
  if (!(opening && doorLeaf && swing && arrow)) {
    throw new Error("Expected door elements");
  }

  expect(svg.props.viewBox).toBe("-20 -20 140 184");
  expect(opening.props.x1).toBe(10);
  expect(opening.props.x2).toBe(40);
  expect(opening.props.y1).toBe(100);
  expect(opening.props.y2).toBe(100);
  expect(doorLeaf.props.x1).toBe(40);
  expect(doorLeaf.props.x2).toBe(40);
  expect(doorLeaf.props.y1).toBe(100);
  expect(doorLeaf.props.y2).toBe(70);
  expect(swing.props.d).toBe(
    "M 10 100 C 10 83.431457506 23.431457506 70 40 70"
  );
  expect(firstChild(arrow).props.x1).toBe(25);
});

test("rotates geometry while keeping labels upright", () => {
  const table: Table = {
    _cloudId: "cloud",
    id: "table-1",
    name: "T1",
    positionX: "40",
    positionY: "20",
  };

  const svg = TableMap({
    tables: [table],
    tableStyle: () => "is-muted",
    rotation: 90,
    roomLayout: {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    },
  }) as ReactElementLike;
  const [rotationGroup, label] = childrenOf(svg);
  if (!(rotationGroup && label)) throw new Error("Expected rotated map label");
  const tableGroup = childrenOf(rotationGroup)[1];
  if (!tableGroup) throw new Error("Expected rotated table geometry");

  expect(svg.props.viewBox).toBe("5 -45 90 140");
  expect(rotationGroup.props.transform).toBe("rotate(90 50 25)");
  expect(tableGroup.props.transform).toBe("translate(40 20)");
  expect(label.props.transform).toBeUndefined();
  expect(label.props.x).toBe(55);
  expect(label.props.y).toBe(15);
});

test("activates a table from Enter or Space and ignores other keys", () => {
  const table: Table = { _cloudId: "cloud", id: "table-1", name: "T1" };
  const clicks: Table[] = [];
  const prevented: string[] = [];

  const svg = TableMap({
    tables: [table],
    tableStyle: () => "is-muted",
    onTableClick: (clickedTable) => clicks.push(clickedTable),
  }) as ReactElementLike;
  const group = firstChild(svg);

  for (const key of ["Enter", " ", "Tab", "a"]) {
    group.props.onKeyDown?.({
      key,
      preventDefault: () => prevented.push(key),
    });
  }

  expect(clicks).toEqual([table, table]);
  expect(prevented).toEqual(["Enter", " "]);
});

test("renders a static image keyed by table id with fallback button labels for unnamed tables", () => {
  const unnamed: Table = {
    id: "table-unnamed",
    _cloudId: "cloud",
    name: "",
    positionX: "not a number",
    positionY: "5",
    type: "ROUND",
  };

  const staticSvg = TableMap({
    tables: [unnamed],
    tableStyle: () => "is-muted",
  }) as ReactElementLike;
  const [geometry, label] = childrenOf(staticSvg);
  if (!(geometry && label))
    throw new Error("Expected table geometry and label");

  expect(staticSvg.props.role).toBe("img");
  expect(geometry.key).toBe("table-unnamed");
  expect(geometry.props.role).toBeUndefined();
  expect(geometry.props.transform).toBe("translate(0 5)");
  expect(label.key).toBe("table-unnamed-label");
  expect(staticSvg.props.viewBox).toBe("-52 -47 104 104");

  const interactiveSvg = TableMap({
    tables: [unnamed, { ...unnamed, id: "table-blank", name: "  " }],
    tableStyle: () => "is-muted",
    onTableClick: () => undefined,
  }) as ReactElementLike;
  const [first, second] = childrenOf(interactiveSvg);

  expect(first?.props["aria-label"]).toBe("Table");
  expect(second?.props["aria-label"]).toBe("Table");
});

test("frames an empty map in a unit view box", () => {
  const svg = TableMap({
    tables: [],
    tableStyle: () => "is-muted",
    ariaLabel: "Empty room",
  }) as ReactElementLike;

  expect(svg.props.viewBox).toBe("0 0 1 1");
  expect(svg.props["aria-label"]).toBe("Empty room");
  expect(childrenOf(svg)).toEqual([]);
});
