import { Match, Schema } from "effect";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import { workspaceCoworkProductTargetSchema } from "@/features/reservation/cowork-reservation-product";
import { workspaceMeetingRoomProductTargetSchema } from "@/features/reservation/meeting-room-reservation";
import { workspaceOfficeProductTargetSchema } from "@/features/reservation/office-reservation";

export const workspaceProductTargetSchema = Schema.Union([
  workspaceCoworkProductTargetSchema,
  workspaceMeetingRoomProductTargetSchema,
  workspaceOfficeProductTargetSchema,
]);

export type WorkspaceProductTarget = typeof workspaceProductTargetSchema.Type;

export const workspaceProductTargets = [
  { kind: "cowork" as const },
  { kind: "meeting-room" as const },
  { kind: "office" as const },
] satisfies readonly WorkspaceProductTarget[];

export const getWorkspaceProductTarget = (
  product: WorkspaceProductIdentity
): WorkspaceProductTarget =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => workspaceCoworkProductTargetSchema.make({ kind: "cowork" }),
      "meeting-room": () =>
        workspaceMeetingRoomProductTargetSchema.make({
          kind: "meeting-room",
        }),
      office: () => workspaceOfficeProductTargetSchema.make({ kind: "office" }),
    })
  );

export const workspaceProductTargetMatches = (
  target: WorkspaceProductTarget,
  product: WorkspaceProductIdentity
): boolean => target.kind === product.kind;
