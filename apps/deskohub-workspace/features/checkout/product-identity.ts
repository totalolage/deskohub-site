import { Match, Schema } from "effect";
import {
  workspaceCoworkProductTiers,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";

export const workspaceCoworkProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal("cowork"),
  tier: Schema.Literals(workspaceCoworkProductTiers),
});

export const workspaceMeetingRoomProductIdentitySchema = Schema.Struct({
  kind: Schema.Literal("meeting-room"),
  durationMinutes: Schema.Literals(workspaceMeetingRoomDurationOptions),
});

export const workspaceProductIdentitySchema = Schema.Union([
  workspaceCoworkProductIdentitySchema,
  workspaceMeetingRoomProductIdentitySchema,
]);

export type WorkspaceCoworkProductIdentity =
  typeof workspaceCoworkProductIdentitySchema.Type;
export type WorkspaceMeetingRoomProductIdentity =
  typeof workspaceMeetingRoomProductIdentitySchema.Type;
export type WorkspaceProductIdentity =
  typeof workspaceProductIdentitySchema.Type;

export const workspaceCoworkProductKeySchema = Schema.TemplateLiteral([
  workspaceCoworkProductIdentitySchema.fields.kind,
  ":",
  workspaceCoworkProductIdentitySchema.fields.tier,
]);

export const workspaceMeetingRoomProductKeySchema = Schema.TemplateLiteral([
  workspaceMeetingRoomProductIdentitySchema.fields.kind,
  ":",
  workspaceMeetingRoomProductIdentitySchema.fields.durationMinutes,
]);

export const workspaceProductKeySchema = Schema.Union([
  workspaceCoworkProductKeySchema,
  workspaceMeetingRoomProductKeySchema,
]);

export type WorkspaceCoworkProductKey =
  typeof workspaceCoworkProductKeySchema.Type;
export type WorkspaceMeetingRoomProductKey =
  typeof workspaceMeetingRoomProductKeySchema.Type;
export type WorkspaceProductKey = typeof workspaceProductKeySchema.Type;

export const getWorkspaceProductKey = (
  product: WorkspaceProductIdentity
): WorkspaceProductKey =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ kind, tier }) => `${kind}:${tier}` as const,
      "meeting-room": ({ durationMinutes, kind }) =>
        `${kind}:${durationMinutes}` as const,
    })
  );
