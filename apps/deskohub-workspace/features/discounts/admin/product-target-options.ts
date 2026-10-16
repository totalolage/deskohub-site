import { m } from "@/features/administration/i18n";
import { getWorkspaceProductTierTitle } from "@/features/checkout/product-catalog.i18n";
import {
  getWorkspaceProductTargetKey,
  type WorkspaceProductTarget,
  type WorkspaceProductTargetKey,
  workspaceCoworkTierProductTargets,
  workspaceProductTargets,
} from "@/features/discounts/product-target";
import type { Locale } from "@/features/i18n";

export const getDiscountProductTargetLabel = (
  target: WorkspaceProductTarget,
  locale: Locale
): string => {
  if (target.kind === "cowork") {
    return target.tier === undefined
      ? m.discountsProductAllCoworkTiers({}, { locale })
      : m.discountsProductCoworkTierOnly(
          { product: getWorkspaceProductTierTitle(target.tier, locale) },
          { locale }
        );
  }
  return target.kind === "meeting-room"
    ? m.discountsProductMeetingRoom({}, { locale })
    : m.discountsProductPrivateOffice({}, { locale });
};

/** Every target an operator can choose, with each cowork tier after cowork. */
export const discountProductTargetOptions = workspaceProductTargets
  .flatMap((target): readonly WorkspaceProductTarget[] =>
    target.kind === "cowork"
      ? [target, ...workspaceCoworkTierProductTargets]
      : [target]
  )
  .map((target) => ({
    key: getWorkspaceProductTargetKey(target),
    target,
  }));

export const discountProductTargetKeys = discountProductTargetOptions.map(
  ({ key }) => key
) as [WorkspaceProductTargetKey, ...WorkspaceProductTargetKey[]];

/** Maps chosen option keys to targets in option order. */
export const toDiscountProductTargets = (
  keys: readonly WorkspaceProductTargetKey[]
): WorkspaceProductTarget[] =>
  discountProductTargetOptions
    .filter(({ key }) => keys.includes(key))
    .map(({ target }) => target);

export const formatDiscountProductTargets = (
  targets: readonly WorkspaceProductTarget[],
  locale: Locale
) =>
  targets
    .map((target) => getDiscountProductTargetLabel(target, locale))
    .join(", ");
