import { Match, Schema } from "effect";
import {
  workspaceCoworkProductCatalog,
  workspaceMeetingRoomCatalog,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductKey,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import { workspaceCoworkProductIdentitySchema } from "@/features/reservation/cowork-reservation-product";
import { workspaceMeetingRoomProductIdentitySchema } from "@/features/reservation/meeting-room-reservation";
import { officeReservationKind } from "@/features/reservation/reservation-kind";

export const workspaceOfficeProductTargetSchema = Schema.Struct({
  kind: Schema.Literal(officeReservationKind),
});

export const workspaceProductTargetSchema = Schema.Union([
  workspaceCoworkProductIdentitySchema,
  workspaceMeetingRoomProductIdentitySchema,
  workspaceOfficeProductTargetSchema,
]);

export type WorkspaceProductTarget = typeof workspaceProductTargetSchema.Type;

export const workspaceProductTargets = [
  ...workspaceCoworkProductCatalog.map(({ tier }) => ({
    kind: "cowork" as const,
    tier,
  })),
  ...workspaceMeetingRoomCatalog.map(({ duration }) => ({
    kind: "meeting-room" as const,
    duration,
  })),
  { kind: "office" as const },
] satisfies readonly WorkspaceProductTarget[];

export const getWorkspaceProductTargetKey = (
  target: WorkspaceProductTarget
): string =>
  Match.value(target).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getWorkspaceProductKey,
      "meeting-room": getWorkspaceProductKey,
      office: ({ kind }) => kind,
    })
  );

export const workspaceProductTargetMatches = (
  target: WorkspaceProductTarget,
  product: WorkspaceProductIdentity
): boolean =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (cowork) =>
        target.kind === "cowork" &&
        getWorkspaceProductTargetKey(target) === getWorkspaceProductKey(cowork),
      "meeting-room": (meetingRoom) =>
        target.kind === "meeting-room" &&
        getWorkspaceProductTargetKey(target) ===
          getWorkspaceProductKey(meetingRoom),
      office: () => target.kind === "office",
    })
  );
