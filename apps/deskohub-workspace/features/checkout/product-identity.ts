import { Match, Schema } from "effect";
import {
  getCanonicalWorkspaceGoodsProductIdentity,
  getWorkspaceGoodsProductKey,
  workspaceGoodsProductIdentitySchema,
  workspaceGoodsProductKeySchema,
} from "@/features/goods";
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
import {
  getWorkspaceOfficeProductKey,
  workspaceOfficeProductIdentitySchema,
  workspaceOfficeProductKeySchema,
} from "@/features/reservation/office-reservation";

export const workspaceProductIdentitySchema = Schema.Union([
  workspaceCoworkProductIdentitySchema,
  workspaceMeetingRoomProductIdentitySchema,
  workspaceOfficeProductIdentitySchema,
  workspaceGoodsProductIdentitySchema,
]);

export type WorkspaceProductIdentity =
  typeof workspaceProductIdentitySchema.Type;

export const workspaceProductKeySchema = Schema.Union([
  workspaceCoworkProductKeySchema,
  workspaceMeetingRoomProductKeySchema,
  workspaceOfficeProductKeySchema,
  workspaceGoodsProductKeySchema,
]);

export type WorkspaceProductKey = typeof workspaceProductKeySchema.Type;

export const getWorkspaceProductKey = (
  product: WorkspaceProductIdentity
): WorkspaceProductKey =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: getWorkspaceCoworkProductKey,
      goods: getWorkspaceGoodsProductKey,
      "meeting-room": getWorkspaceMeetingRoomProductKey,
      office: getWorkspaceOfficeProductKey,
    })
  );

export const getCanonicalWorkspaceProductIdentity = (
  product: WorkspaceProductIdentity
): WorkspaceProductIdentity =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ kind, tier }) => ({ kind, tier }),
      goods: getCanonicalWorkspaceGoodsProductIdentity,
      "meeting-room": ({ duration, kind }) => ({
        kind,
        duration,
      }),
      office: ({ dayCount, kind, seats }) => ({ kind, seats, dayCount }),
    })
  );
