import type { CSSProperties, KeyboardEventHandler } from "react";
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

export function TableMap({
  tables,
  width,
  height,
  rotation,
  style,
  tableStyle,
  tableLabelStyle,
  tableShapeInlineStyle,
  tableLabelInlineStyle,
  roomLayout,
  onTableClick,
  ariaLabel = "Dotypos table map",
}: TableMapProps) {
  const positionedTables = tables.map((table) => {
    const shape = tableShapes[table.type ?? "GENERIC"];
    const box = getShapeBox(shape);

    return {
      table,
      shape,
      className: tableStyle(table),
      labelClassName: tableLabelStyle?.(table),
      shapeStyle: tableShapeInlineStyle?.(table),
      labelStyle: tableLabelInlineStyle?.(table),
      x: parseTableNumber(table.positionX),
      y: parseTableNumber(table.positionY),
      rotation: parseTableNumber(table.rotation),
      width: box.width,
      height: box.height,
    };
  });

  const bounds = [
    ...positionedTables.map((table) => ({
      minX: table.x - table.width / 2 - padding,
      minY: table.y - table.height / 2 - padding,
      maxX: table.x + table.width / 2 + padding,
      maxY: table.y + table.height / 2 + padding,
    })),
    ...(roomLayout ? [getRoomLayoutBounds(roomLayout)] : []),
  ];

  const contentBounds = {
    minX: bounds.length ? Math.min(...bounds.map((box) => box.minX)) : 0,
    minY: bounds.length ? Math.min(...bounds.map((box) => box.minY)) : 0,
    maxX: bounds.length ? Math.max(...bounds.map((box) => box.maxX)) : 1,
    maxY: bounds.length ? Math.max(...bounds.map((box) => box.maxY)) : 1,
  } satisfies Bounds;
  const outputRotation = getOutputRotation(rotation);
  const viewBoxBounds = outputRotation
    ? getRotatedBounds(contentBounds, outputRotation)
    : contentBounds;
  const centerX = (contentBounds.minX + contentBounds.maxX) / 2;
  const centerY = (contentBounds.minY + contentBounds.maxY) / 2;

  const labelRotation = outputRotation
    ? getRotation(outputRotation)
    : undefined;
  const tableGeometry = positionedTables.map(
    ({ table, shape, className, shapeStyle, x, y, rotation }) => (
      <g
        key={table.id ?? `${table.name}-${x}-${y}`}
        transform={`translate(${x} ${y})`}
        {...getInteractionProps(table, onTableClick)}
      >
        <g transform={`rotate(${rotation})`}>
          {renderShape(shape, className, shapeStyle)}
        </g>
      </g>
    )
  );
  const geometry = [
    ...(roomLayout ? [renderRoomLayout(roomLayout)] : []),
    ...tableGeometry,
  ];
  const rotatedGeometry = outputRotation
    ? [
        <g
          key="output-rotation"
          transform={`rotate(${formatSvgNumber(outputRotation)} ${formatSvgNumber(centerX)} ${formatSvgNumber(centerY)})`}
        >
          {geometry}
        </g>,
      ]
    : geometry;
  const tableLabels = positionedTables.map(
    ({ table, labelClassName, labelStyle, x, y }) => {
      const labelPosition = labelRotation
        ? rotatePoint(
            x,
            y,
            centerX,
            centerY,
            labelRotation.cos,
            labelRotation.sin
          )
        : { x, y };

      return (
        <text
          key={`${table.id ?? `${table.name}-${x}-${y}`}-label`}
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
  );
  const renderedChildren = [...rotatedGeometry, ...tableLabels];

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      style={style}
      viewBox={`${formatSvgNumber(viewBoxBounds.minX)} ${formatSvgNumber(viewBoxBounds.minY)} ${formatSvgNumber(viewBoxBounds.maxX - viewBoxBounds.minX)} ${formatSvgNumber(viewBoxBounds.maxY - viewBoxBounds.minY)}`}
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
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
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
