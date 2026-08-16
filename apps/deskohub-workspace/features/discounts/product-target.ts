import { Match, Schema } from "effect";
import type { WorkspaceProductIdentity } from "@/features/checkout/product-identity";
import {
  getWorkspaceGoodsProductTarget,
  workspaceGoodsTargetMatches,
  workspaceGoodsTargetSchema,
} from "@/features/goods";
import { workspaceCoworkProductTargetSchema } from "@/features/reservation/cowork-reservation-product";
import { workspaceMeetingRoomProductTargetSchema } from "@/features/reservation/meeting-room-reservation";
import { workspaceOfficeProductTargetSchema } from "@/features/reservation/office-reservation";

export const workspaceProductTargetSchema = Schema.Union([
  workspaceCoworkProductTargetSchema,
  workspaceMeetingRoomProductTargetSchema,
  workspaceOfficeProductTargetSchema,
  workspaceGoodsTargetSchema,
]);

export type WorkspaceProductTarget = typeof workspaceProductTargetSchema.Type;

export const workspaceProductTargets = [
  { kind: "cowork" as const },
  { kind: "meeting-room" as const },
  { kind: "office" as const },
  { kind: "goods" as const },
] satisfies readonly WorkspaceProductTarget[];

export const getWorkspaceProductTarget = (
  product: WorkspaceProductIdentity
): WorkspaceProductTarget =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => workspaceCoworkProductTargetSchema.make({ kind: "cowork" }),
      goods: getWorkspaceGoodsProductTarget,
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
): boolean =>
  Match.value(target).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => product.kind === "cowork",
      goods: (goodsTarget) =>
        product.kind === "goods" &&
        workspaceGoodsTargetMatches(goodsTarget, product),
      "meeting-room": () => product.kind === "meeting-room",
      office: () => product.kind === "office",
    })
  );

export const getWorkspaceProductTargetKey = (
  target: WorkspaceProductTarget
): string =>
  Match.value(target).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ kind }) => kind,
      goods: (goodsTarget) => {
        if ("categoryId" in goodsTarget) {
          return `${goodsTarget.kind}:category:${goodsTarget.categoryId}`;
        }
        if ("productId" in goodsTarget) {
          return `${goodsTarget.kind}:product:${goodsTarget.productId}`;
        }
        return goodsTarget.kind;
      },
      "meeting-room": ({ kind }) => kind,
      office: ({ kind }) => kind,
    })
  );
