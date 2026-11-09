import type { CSSProperties, KeyboardEventHandler, ReactElement } from "react";
import type { Table } from "./generated";

type TableType = NonNullable<Table["type"]>;

type TableShape =
  | {
      readonly kind: "circle";
      readonly size: number;
    }
  | {
      readonly kind: "rect";
      readonly width: number;
      readonly height: number;
      readonly radius: number;
    };

export interface TableMapProps {
  readonly tables: readonly Table[];
  readonly width?: number;
  readonly height?: number;
  readonly rotation?: number;
  readonly style?: CSSProperties;
  readonly tableStyle: (table: Table) => string;
  readonly tableLabelStyle?: (table: Table) => string;
  readonly tableShapeInlineStyle?: (table: Table) => CSSProperties;
  readonly tableLabelInlineStyle?: (table: Table) => CSSProperties;
  readonly roomLayout?: TableMapRoomLayout;
  readonly onTableClick?: (table: Table) => void;
  readonly ariaLabel?: string;
}

export interface TableMapRoomLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly radius?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly doors?: readonly TableMapRoomDoor[];
}

export interface TableMapRoomDoor {
  readonly wall: "bottom";
  readonly offset: number;
  readonly width: number;
  readonly className?: string;
  readonly doorClassName?: string;
  readonly swingClassName?: string;
  readonly showEntranceArrow?: boolean;
  readonly entranceArrowClassName?: string;
}

const tableShapes: Record<TableType, TableShape> = {
  SQUARE: { kind: "rect", width: 56, height: 56, radius: 6 },
  SQUARE6: { kind: "rect", width: 84, height: 56, radius: 6 },
  CIRCLE2: { kind: "circle", size: 48 },
  CIRCLE4: { kind: "circle", size: 64 },
  DELIVERY: { kind: "rect", width: 64, height: 40, radius: 6 },
  CHAIR_SINGLE: { kind: "circle", size: 32 },
  ROUND: { kind: "circle", size: 64 },
  DOOR: { kind: "rect", width: 56, height: 16, radius: 2 },
  GENERIC: { kind: "rect", width: 56, height: 40, radius: 6 },
  CAR1: { kind: "rect", width: 80, height: 40, radius: 10 },
  CAR2: { kind: "rect", width: 80, height: 40, radius: 10 },
};

const padding = 20;
const quarterCircleControl = 0.552_284_749_8;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

const parseTableNumber = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getShapeBox = (shape: TableShape) => {
  if (shape.kind === "circle") {
    return { width: shape.size, height: shape.size };
  }

  return { width: shape.width, height: shape.height };
};

type TableMapTableStyles = Pick<
  TableMapProps,
  | "tableStyle"
  | "tableLabelStyle"
  | "tableShapeInlineStyle"
  | "tableLabelInlineStyle"
>;

type PositionedTable = ReturnType<typeof positionTable>;

type Point = { readonly x: number; readonly y: number };

/** The table's shape, styles, and parsed position on the map. */
const positionTable = (table: Table, styles: TableMapTableStyles) => {
  const shape = tableShapes[table.type ?? "GENERIC"];
  const box = getShapeBox(shape);

  return {
    table,
    shape,
    className: styles.tableStyle(table),
    labelClassName: styles.tableLabelStyle?.(table),
    shapeStyle: styles.tableShapeInlineStyle?.(table),
    labelStyle: styles.tableLabelInlineStyle?.(table),
    x: parseTableNumber(table.positionX),
    y: parseTableNumber(table.positionY),
    rotation: parseTableNumber(table.rotation),
    width: box.width,
    height: box.height,
  };
};

const getTableBounds = (table: PositionedTable): Bounds => ({
  minX: table.x - table.width / 2 - padding,
  minY: table.y - table.height / 2 - padding,
  maxX: table.x + table.width / 2 + padding,
  maxY: table.y + table.height / 2 + padding,
});

/** The padded box around every table and the room; a unit box when empty. */
const getContentBounds = (
  tables: readonly PositionedTable[],
  roomLayout: TableMapRoomLayout | undefined
): Bounds => {
  const bounds = [
    ...tables.map(getTableBounds),
    ...(roomLayout ? [getRoomLayoutBounds(roomLayout)] : []),
  ];
  if (!bounds.length) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  return {
    minX: Math.min(...bounds.map((box) => box.minX)),
    minY: Math.min(...bounds.map((box) => box.minY)),
    maxX: Math.max(...bounds.map((box) => box.maxX)),
    maxY: Math.max(...bounds.map((box) => box.maxY)),
  };
};

const getBoundsCenter = (bounds: Bounds): Point => ({
  x: (bounds.minX + bounds.maxX) / 2,
  y: (bounds.minY + bounds.maxY) / 2,
});

const getTableKey = ({ table }: PositionedTable) => table.id;

function renderTableGeometry(
  positionedTable: PositionedTable,
  onTableClick: TableMapProps["onTableClick"]
) {
  const { table, shape, className, shapeStyle, x, y, rotation } =
    positionedTable;

  return (
    <g
      key={getTableKey(positionedTable)}
      transform={`translate(${x} ${y})`}
      {...getInteractionProps(table, onTableClick)}
    >
      <g transform={`rotate(${rotation})`}>
        {renderShape(shape, className, shapeStyle)}
      </g>
    </g>
  );
}

/** Wraps the map geometry in the output rotation around the content center. */
function rotateGeometry(
  geometry: readonly ReactElement[],
  outputRotation: number,
  center: Point
) {
  if (!outputRotation) return geometry;

  return [
    <g
      key="output-rotation"
      transform={`rotate(${formatSvgNumber(outputRotation)} ${formatSvgNumber(center.x)} ${formatSvgNumber(center.y)})`}
    >
      {geometry}
    </g>,
  ];
}

/** An upright label at the table's position after the output rotation. */
function renderTableLabel(
  positionedTable: PositionedTable,
  labelRotation: ReturnType<typeof getRotation> | undefined,
  center: Point
) {
  const { table, labelClassName, labelStyle, x, y } = positionedTable;
  const labelPosition = labelRotation
    ? rotatePoint(
        x,
        y,
        center.x,
        center.y,
        labelRotation.cos,
        labelRotation.sin
      )
    : { x, y };

  return (
    <text
      key={`${getTableKey(positionedTable)}-label`}
      x={Number(formatSvgNumber(labelPosition.x))}
      y={Number(formatSvgNumber(labelPosition.y))}
      className={labelClassName}
      style={labelStyle}
      textAnchor="middle"
      dominantBaseline="middle"
      pointerEvents="none"
    >
      {table.name}
    </text>
  );
}

const formatViewBox = (bounds: Bounds) =>
  `${formatSvgNumber(bounds.minX)} ${formatSvgNumber(bounds.minY)} ${formatSvgNumber(bounds.maxX - bounds.minX)} ${formatSvgNumber(bounds.maxY - bounds.minY)}`;

export function TableMap({
  tables,
  width,
  height,
  rotation,
  style,
  roomLayout,
  onTableClick,
  ariaLabel = "Dotypos table map",
  ...tableStyles
}: TableMapProps) {
  const positionedTables = tables.map((table) =>
    positionTable(table, tableStyles)
  );
  const contentBounds = getContentBounds(positionedTables, roomLayout);
  const outputRotation = getOutputRotation(rotation);
  const viewBoxBounds = outputRotation
    ? getRotatedBounds(contentBounds, outputRotation)
    : contentBounds;
  const center = getBoundsCenter(contentBounds);
  const labelRotation = outputRotation
    ? getRotation(outputRotation)
    : undefined;
  const geometry = [
    ...(roomLayout ? [renderRoomLayout(roomLayout)] : []),
    ...positionedTables.map((table) =>
      renderTableGeometry(table, onTableClick)
    ),
  ];
  const renderedChildren = [
    ...rotateGeometry(geometry, outputRotation, center),
    ...positionedTables.map((table) =>
      renderTableLabel(table, labelRotation, center)
    ),
  ];

  return (
    <svg
      role={onTableClick ? "group" : "img"}
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      style={style}
      viewBox={formatViewBox(viewBoxBounds)}
    >
      {renderedChildren}
    </svg>
  );
}

const formatSvgNumber = (value: number) => Number(value.toFixed(6)).toString();

const getOutputRotation = (rotation: number | undefined) => {
  if (rotation === undefined || !Number.isFinite(rotation)) return 0;

  return rotation % 360;
};

function getRotatedBounds(bounds: Bounds, rotation: number): Bounds {
  const { x: centerX, y: centerY } = getBoundsCenter(bounds);
  const { cos, sin } = getRotation(rotation);
  const points = [
    rotatePoint(bounds.minX, bounds.minY, centerX, centerY, cos, sin),
    rotatePoint(bounds.maxX, bounds.minY, centerX, centerY, cos, sin),
    rotatePoint(bounds.maxX, bounds.maxY, centerX, centerY, cos, sin),
    rotatePoint(bounds.minX, bounds.maxY, centerX, centerY, cos, sin),
  ];

  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function getRotation(rotation: number) {
  const radians = (rotation * Math.PI) / 180;

  return {
    cos: Math.cos(radians),
    sin: Math.sin(radians),
  };
}

function rotatePoint(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  cos: number,
  sin: number
) {
  const dx = x - centerX;
  const dy = y - centerY;

  return {
    x: centerX + dx * cos - dy * sin,
    y: centerY + dx * sin + dy * cos,
  };
}

const getInteractionProps = (
  table: Table,
  onTableClick: TableMapProps["onTableClick"]
) => {
  if (!onTableClick) return {};

  const onKeyDown: KeyboardEventHandler<SVGGElement> = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onTableClick(table);
    }
  };

  return {
    "aria-label": table.name?.trim() || "Table",
    role: "button",
    tabIndex: 0,
    onClick: () => onTableClick(table),
    onKeyDown,
  };
};

function renderShape(
  shape: TableShape,
  className: string,
  style: CSSProperties | undefined
) {
  if (shape.kind === "circle") {
    return <circle r={shape.size / 2} className={className} style={style} />;
  }

  return (
    <rect
      x={-shape.width / 2}
      y={-shape.height / 2}
      width={shape.width}
      height={shape.height}
      rx={shape.radius}
      className={className}
      style={style}
    />
  );
}

function renderRoomLayout(layout: TableMapRoomLayout) {
  const children = [
    <rect
      key="room-bounds"
      x={layout.x}
      y={layout.y}
      width={layout.width}
      height={layout.height}
      rx={layout.radius ?? 0}
      className={layout.className}
      style={layout.style}
    />,
    ...(layout.doors?.map((door, index) =>
      renderRoomDoor(layout, door, index)
    ) ?? []),
  ];

  return <g key="room-layout">{children}</g>;
}

function getRoomLayoutBounds(layout: TableMapRoomLayout) {
  const hasEntranceArrow = layout.doors?.some((door) => door.showEntranceArrow);

  return {
    minX: layout.x - padding,
    minY: layout.y - padding,
    maxX: layout.x + layout.width + padding,
    maxY: layout.y + layout.height + (hasEntranceArrow ? 64 : padding),
  };
}

function renderRoomDoor(
  layout: TableMapRoomLayout,
  door: TableMapRoomDoor,
  index: number
) {
  const startX = layout.x + door.offset;
  const hingeX = startX + door.width;
  const wallY = layout.y + layout.height;
  const openY = wallY - door.width;
  const controlOffset = door.width * quarterCircleControl;

  return (
    <g key={`door-${index}`}>
      <line
        x1={startX}
        y1={wallY}
        x2={hingeX}
        y2={wallY}
        fill="none"
        stroke="white"
        strokeWidth={14}
        className={door.className}
      />
      <line
        x1={hingeX}
        y1={wallY}
        x2={hingeX}
        y2={openY}
        fill="none"
        stroke="#00024f"
        strokeOpacity={0.7}
        strokeWidth={3}
        className={door.doorClassName}
      />
      <path
        d={`M ${startX} ${wallY} C ${startX} ${wallY - controlOffset} ${hingeX - controlOffset} ${openY} ${hingeX} ${openY}`}
        fill="none"
        stroke="#00024f"
        strokeOpacity={0.24}
        strokeWidth={2}
        className={door.swingClassName}
      />
      {door.showEntranceArrow
        ? renderEntranceArrow(
            startX + door.width / 2,
            wallY,
            door.entranceArrowClassName
          )
        : null}
    </g>
  );
}

function renderEntranceArrow(
  x: number,
  y: number,
  className: string | undefined
) {
  return (
    <g key="entrance-arrow" color="#00df99" className={className}>
      <line
        x1={x}
        y1={y + 54}
        x2={x}
        y2={y + 12}
        fill="none"
        stroke="currentColor"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <polygon
        points={`${x},${y - 12} ${x - 12},${y + 12} ${x + 12},${y + 12}`}
        fill="currentColor"
      />
    </g>
  );
}
