import { Match, Schema } from "effect";
import { workspaceCoworkProductTiers } from "@/features/checkout/product-catalog";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import {
  type WorkspaceCoworkProductTarget,
  workspaceCoworkProductTargetSchema,
} from "@/features/reservation/cowork-reservation-product";
import {
  type WorkspaceMeetingRoomProductTarget,
  workspaceMeetingRoomProductTargetSchema,
} from "@/features/reservation/meeting-room-reservation";
import { meetingRoomReservationDurations } from "@/features/reservation/meeting-room-reservation-duration";
import {
  type WorkspaceOfficeProductTarget,
  workspaceOfficeProductTargetSchema,
} from "@/features/reservation/office-reservation";

export const workspaceProductTargetSchema = Schema.Union([
  workspaceCoworkProductTargetSchema,
  workspaceMeetingRoomProductTargetSchema,
  workspaceOfficeProductTargetSchema,
]);

export type WorkspaceProductTarget =
  | WorkspaceCoworkProductTarget
  | WorkspaceMeetingRoomProductTarget
  | WorkspaceOfficeProductTarget;

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

export const getLegacyWorkspaceProductIdentities = (
  target: WorkspaceProductTarget
): readonly WorkspaceProductIdentity[] =>
  Match.value(target).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () =>
        workspaceCoworkProductTiers.map((tier) => ({
          kind: "cowork" as const,
          tier,
        })),
      "meeting-room": () =>
        meetingRoomReservationDurations.map((duration) => ({
          kind: "meeting-room" as const,
          duration,
        })),
      office: () => [{ kind: "office" as const, seats: 1, dayCount: 1 }],
    })
  );

export const getUniqueWorkspaceProductTargets = (
  targets: readonly WorkspaceProductTarget[]
): readonly WorkspaceProductTarget[] =>
  workspaceProductTargets.filter(({ kind }) =>
    targets.some((target) => target.kind === kind)
  );

export const workspaceProductTargetMatches = (
  target: WorkspaceProductTarget,
  product: WorkspaceProductIdentity
): boolean => target.kind === product.kind;
