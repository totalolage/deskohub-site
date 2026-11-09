import { Match, Schema } from "effect";
import { workspaceCoworkCurrentTiers } from "@/features/checkout/product-catalog";
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

export type WorkspaceProductFamily = WorkspaceProductTarget["kind"];

/** Family targets, each covering every product of its reservation family. */
export const workspaceProductTargets = [
  { kind: "cowork" as const },
  { kind: "meeting-room" as const },
  { kind: "office" as const },
] satisfies readonly WorkspaceProductTarget[];

export const workspaceProductFamilies: readonly WorkspaceProductFamily[] =
  workspaceProductTargets.map(({ kind }) => kind);

/** Cowork tier targets, each covering one saleable cowork tier. */
export const workspaceCoworkTierProductTargets =
  workspaceCoworkCurrentTiers.map((tier) => ({
    kind: "cowork" as const,
    tier,
  })) satisfies readonly WorkspaceProductTarget[];

export type WorkspaceProductTargetKey =
  | WorkspaceProductFamily
  | `cowork:${(typeof workspaceCoworkCurrentTiers)[number]}`;

export const getWorkspaceProductTargetKey = (
  target: WorkspaceProductTarget
): WorkspaceProductTargetKey =>
  target.kind === "cowork" && target.tier !== undefined
    ? `cowork:${target.tier}`
    : target.kind;

/**
 * Every target value that covers the product: its family target and, for a
 * saleable cowork tier, that tier's target.
 */
export const getWorkspaceProductTargetsCovering = (
  product: WorkspaceProductIdentity
): readonly [WorkspaceProductTarget, ...WorkspaceProductTarget[]] =>
  Match.value(product).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ tier }) => {
        const family = workspaceCoworkProductTargetSchema.make({
          kind: "cowork",
        });
        const tierTarget = workspaceCoworkTierProductTargets.find(
          (target) => target.tier === tier
        );
        return tierTarget
          ? ([
              family,
              workspaceCoworkProductTargetSchema.make(tierTarget),
            ] as const)
          : ([family] as const);
      },
      "meeting-room": () =>
        [
          workspaceMeetingRoomProductTargetSchema.make({
            kind: "meeting-room",
          }),
        ] as const,
      office: () =>
        [workspaceOfficeProductTargetSchema.make({ kind: "office" })] as const,
    })
  );

export const workspaceProductTargetMatches = (
  target: WorkspaceProductTarget,
  product: WorkspaceProductIdentity
): boolean =>
  target.kind === product.kind &&
  (target.kind !== "cowork" ||
    target.tier === undefined ||
    (product.kind === "cowork" && target.tier === product.tier));

/** Whether the targets together cover every product of the family. */
export const workspaceProductTargetsCoverFamily = (
  targets: readonly WorkspaceProductTarget[],
  family: WorkspaceProductFamily
): boolean => {
  const keys = new Set(targets.map(getWorkspaceProductTargetKey));
  return (
    keys.has(family) ||
    (family === "cowork" &&
      workspaceCoworkTierProductTargets.every((target) =>
        keys.has(getWorkspaceProductTargetKey(target))
      ))
  );
};

/**
 * Describes why a discount's targets are incoherent: a repeated target, or a
 * family target alongside one of its tier targets.
 */
export const findWorkspaceProductTargetsIssue = (
  targets: readonly WorkspaceProductTarget[]
): string | undefined => {
  const keys = targets.map(getWorkspaceProductTargetKey);
  if (new Set(keys).size !== keys.length) {
    return "product targets must be unique";
  }
  if (
    keys.includes("cowork") &&
    targets.some(
      ({ kind }, index) => kind === "cowork" && keys[index] !== "cowork"
    )
  ) {
    return "a cowork target covering every tier cannot be combined with cowork tier targets";
  }
  return undefined;
};
