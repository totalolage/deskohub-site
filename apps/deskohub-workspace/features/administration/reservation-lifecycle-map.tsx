"use client";

import {
  Background,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeHandle,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { cn } from "@/shared/utils";

type LifecycleNodeData = {
  readonly label: string;
  readonly note: string;
  readonly tone: "neutral" | "positive" | "warning";
};

const lifecycleHandles: NodeHandle[] = [
  { id: null, position: Position.Left, type: "target", x: 0, y: 33 },
  { id: null, position: Position.Right, type: "source", x: 176, y: 33 },
  { id: "top-source", position: Position.Top, type: "source", x: 88, y: 0 },
  { id: "top-target", position: Position.Top, type: "target", x: 88, y: 0 },
  {
    id: "bottom-source",
    position: Position.Bottom,
    type: "source",
    x: 88,
    y: 66,
  },
  {
    id: "bottom-target",
    position: Position.Bottom,
    type: "target",
    x: 88,
    y: 66,
  },
];

const nodes: Node<LifecycleNodeData>[] = [
  {
    handles: lifecycleHandles,
    id: "started",
    height: 66,
    position: { x: 20, y: 140 },
    data: { label: "Started", note: "Checkout created", tone: "neutral" },
    type: "lifecycle",
    width: 176,
  },
  {
    handles: lifecycleHandles,
    id: "held",
    height: 66,
    position: { x: 245, y: 140 },
    data: { label: "Held", note: "Awaiting payment", tone: "neutral" },
    type: "lifecycle",
    width: 176,
  },
  {
    handles: lifecycleHandles,
    id: "paid",
    height: 66,
    position: { x: 470, y: 140 },
    data: { label: "Paid", note: "Being confirmed", tone: "neutral" },
    type: "lifecycle",
    width: 176,
  },
  {
    handles: lifecycleHandles,
    id: "complete",
    height: 66,
    position: { x: 920, y: 140 },
    data: { label: "Complete", note: "Access delivered", tone: "positive" },
    type: "lifecycle",
    width: 176,
  },
  {
    handles: lifecycleHandles,
    id: "cancelled",
    height: 66,
    position: { x: 695, y: 260 },
    data: { label: "Cancelled", note: "Hold released", tone: "warning" },
    type: "lifecycle",
    width: 176,
  },
  {
    handles: lifecycleHandles,
    id: "attention",
    height: 66,
    position: { x: 695, y: 20 },
    data: {
      label: "Needs attention",
      note: "Confirmation issue",
      tone: "warning",
    },
    type: "lifecycle",
    width: 176,
  },
];

const directionalEdge = {
  markerEnd: {
    color: "rgba(0, 2, 79, 0.55)",
    height: 16,
    type: MarkerType.ArrowClosed,
    width: 16,
  },
  style: { stroke: "rgba(0, 2, 79, 0.55)", strokeWidth: 1.5 },
  type: "smoothstep",
} as const;

const edges: Edge[] = [
  {
    ...directionalEdge,
    id: "started-held",
    source: "started",
    target: "held",
  },
  {
    ...directionalEdge,
    id: "held-paid",
    source: "held",
    target: "paid",
  },
  {
    ...directionalEdge,
    id: "paid-complete",
    source: "paid",
    target: "complete",
  },
  {
    ...directionalEdge,
    id: "held-cancelled",
    source: "held",
    sourceHandle: "bottom-source",
    target: "cancelled",
    targetHandle: "top-target",
  },
  {
    ...directionalEdge,
    id: "paid-attention",
    source: "paid",
    sourceHandle: "top-source",
    target: "attention",
    targetHandle: "bottom-target",
  },
  {
    ...directionalEdge,
    id: "attention-complete",
    source: "attention",
    target: "complete",
  },
];

function LifecycleNode({ data }: NodeProps<Node<LifecycleNodeData>>) {
  return (
    <div
      className={cn(
        "w-44 rounded-xl border bg-white px-4 py-3 shadow-[0_8px_24px_rgba(0,2,79,0.06)]",
        data.tone === "neutral" && "border-navy-blue/15",
        data.tone === "positive" && "border-aquamarine-green/55",
        data.tone === "warning" && "border-burned-orange/35"
      )}
    >
      <Handle
        className="!size-0 !border-0 !bg-transparent"
        position={Position.Left}
        type="target"
      />
      <p className="text-sm font-semibold text-navy-blue">{data.label}</p>
      <p className="mt-1 text-xs text-navy-blue/65">{data.note}</p>
      <Handle
        className="!size-0 !border-0 !bg-transparent"
        position={Position.Right}
        type="source"
      />
      <Handle
        className="!size-0 !border-0 !bg-transparent"
        id="top-source"
        position={Position.Top}
        type="source"
      />
      <Handle
        className="!size-0 !border-0 !bg-transparent"
        id="top-target"
        position={Position.Top}
        type="target"
      />
      <Handle
        className="!size-0 !border-0 !bg-transparent"
        id="bottom-source"
        position={Position.Bottom}
        type="source"
      />
      <Handle
        className="!size-0 !border-0 !bg-transparent"
        id="bottom-target"
        position={Position.Bottom}
        type="target"
      />
    </div>
  );
}

const nodeTypes = { lifecycle: LifecycleNode };

export function ReservationLifecycleMap() {
  return (
    <>
      <div
        aria-hidden="true"
        className="hidden h-[24rem] overflow-hidden rounded-xl border border-navy-blue/10 bg-white lg:block"
      >
        <ReactFlow
          edges={edges}
          edgesFocusable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.1 }}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          nodesFocusable={false}
          nodeTypes={nodeTypes}
          panOnDrag={false}
          preventScrolling={false}
          proOptions={{ hideAttribution: true }}
          zoomOnDoubleClick={false}
          zoomOnPinch={false}
          zoomOnScroll={false}
        >
          <Background color="rgba(0,2,79,0.08)" gap={24} size={1} />
        </ReactFlow>
      </div>
      <ol className="space-y-3 lg:sr-only">
        <li className="rounded-lg border border-navy-blue/10 bg-white p-4">
          <strong>Started → Held</strong>
          <p className="mt-1 text-sm text-navy-blue/65">
            Checkout creates a hold and waits for payment.
          </p>
        </li>
        <li className="rounded-lg border border-navy-blue/10 bg-white p-4">
          <strong>Held → Paid → Complete</strong>
          <p className="mt-1 text-sm text-navy-blue/65">
            Payment is followed by confirmation and customer access delivery.
          </p>
        </li>
        <li className="rounded-lg border border-navy-blue/10 bg-white p-4">
          <strong>Held → Cancelled</strong>
          <p className="mt-1 text-sm text-navy-blue/65">
            Unpaid or abandoned holds are released.
          </p>
        </li>
        <li className="rounded-lg border border-burned-orange/25 bg-white p-4">
          <strong>Paid → Needs attention → Complete</strong>
          <p className="mt-1 text-sm text-navy-blue/65">
            Confirmation issues stay visible until the reservation completes.
          </p>
        </li>
      </ol>
    </>
  );
}
