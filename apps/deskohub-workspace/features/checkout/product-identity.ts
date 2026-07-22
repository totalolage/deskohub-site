import { Match, Schema } from "effect";
import {
  getWorkspaceCoworkProductKey,
  workspaceCoworkProductIdentitySchema,
  workspaceCoworkProductKeySchema,
} from "@/features/reservation/cowork-reservation-product";
import {
  getWorkspaceMeetingRoomProductKey,
  workspaceMeetingRoomProductIdentitySchema,
  workspaceMeetingRoomProductKeySchema,
} from "@/features/reservation/meeting-room-reservation";

export const workspaceProductIdentitySchema = Schema.Union([
  workspaceCoworkProductIdentitySchema,
  workspaceMeetingRoomProductIdentitySchema,
]);

export type WorkspaceProductIdentity =
  typeof workspaceProductIdentitySchema.Type;

export const workspaceProductKeySchema = Schema.Union([
  workspaceCoworkProductKeySchema,
  workspaceMeetingRoomProductKeySchema,
]);

export type WorkspaceProductKey = typeof workspaceProductKeySchema.Type;

export const getWorkspaceProductKey = (
  product: WorkspaceProductIdentity
): WorkspaceProductKey =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getWorkspaceCoworkProductKey,
      "meeting-room": getWorkspaceMeetingRoomProductKey,
    })
  );

export const getCanonicalWorkspaceProductIdentity = (
  product: WorkspaceProductIdentity
): WorkspaceProductIdentity =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ kind, tier }) => ({ kind, tier }),
      "meeting-room": ({ durationMinutes, kind }) => ({
        kind,
        durationMinutes,
      }),
    })
  );
