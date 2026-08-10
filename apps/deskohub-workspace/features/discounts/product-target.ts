import { Schema } from "effect";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";

const workspaceProductTargetKindSchema = Schema.Literals([
  "cowork",
  "meeting-room",
  "office",
]);

export const workspaceProductTargetSchema = Schema.Struct({
  kind: workspaceProductTargetKindSchema,
});

export type WorkspaceProductTarget = typeof workspaceProductTargetSchema.Type;

export const workspaceProductTargets = [
  { kind: "cowork" as const },
  { kind: "meeting-room" as const },
  { kind: "office" as const },
] satisfies readonly WorkspaceProductTarget[];

export const getWorkspaceProductTarget = (
  product: WorkspaceProductIdentity
): WorkspaceProductTarget => ({ kind: product.kind });

export const workspaceProductTargetMatches = (
  target: WorkspaceProductTarget,
  product: WorkspaceProductIdentity
): boolean => target.kind === product.kind;
