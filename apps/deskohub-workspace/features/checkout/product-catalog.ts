import {
  formatWorkspaceMoney,
  type WorkspaceMoney,
  workspaceMoneyFromCurrency,
} from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import { defaultWorkspaceCurrency } from "@/shared/money/currencies";
import { workspaceMeetingRoomProductsByDurationKey } from "./meeting-room-product-catalog";

export {
  workspaceMeetingRoomCatalog,
  workspaceMeetingRoomProductsByDurationKey,
} from "./meeting-room-product-catalog";

export const workspaceCoworkTiers = ["basic", "plus", "profi"] as const;
export const workspaceCoworkProductTiers = workspaceCoworkTiers;
export const workspaceProductTiers = workspaceCoworkTiers;

export const workspaceProductMonitorOptions = [
  "2x27-qhd",
  "2x32-qhd",
  "2x27-4k",
  "2x32-4k",
] as const;

export type WorkspaceCoworkProductTier = (typeof workspaceCoworkTiers)[number];
export type WorkspaceProductTier = WorkspaceCoworkProductTier;
export type WorkspaceProductMonitorOption =
  (typeof workspaceProductMonitorOptions)[number];

export const workspaceProductMonitorOptionTableTags: Record<
  WorkspaceProductMonitorOption,
  readonly string[]
> = {
  "2x27-qhd": ["monitor:count:2", "monitor:size:27", "monitor:resolution:qhd"],
  "2x32-qhd": ["monitor:count:2", "monitor:size:32", "monitor:resolution:qhd"],
  "2x27-4k": ["monitor:count:2", "monitor:size:27", "monitor:resolution:4k"],
  "2x32-4k": ["monitor:count:2", "monitor:size:32", "monitor:resolution:4k"],
};

export type WorkspaceProductCatalogItem = {
  readonly tier: WorkspaceCoworkProductTier;
  readonly label: string;
  readonly price: WorkspaceMoney;
  readonly includesCourtesyCoffee: boolean;
  readonly requiresCoffee: boolean;
  readonly requiresMonitorOption: boolean;
  readonly allowedMonitorOptions: readonly WorkspaceProductMonitorOption[];
};

const workspaceCoworkProductsByTier: Record<
  WorkspaceCoworkProductTier,
  WorkspaceProductCatalogItem
> = {
  basic: {
    tier: "basic",
    label: "Basic Day Pass",
    price: workspaceMoneyFromCurrency(35_000, defaultWorkspaceCurrency),
    includesCourtesyCoffee: false,
    requiresCoffee: false,
    requiresMonitorOption: false,
    allowedMonitorOptions: [],
  },
  plus: {
    tier: "plus",
    label: "Cowork Plus",
    price: workspaceMoneyFromCurrency(49_000, defaultWorkspaceCurrency),
    includesCourtesyCoffee: true,
    requiresCoffee: true,
    requiresMonitorOption: false,
    allowedMonitorOptions: [],
  },
  profi: {
    tier: "profi",
    label: "Profi Workstation",
    price: workspaceMoneyFromCurrency(55_000, defaultWorkspaceCurrency),
    includesCourtesyCoffee: true,
    requiresCoffee: true,
    requiresMonitorOption: true,
    allowedMonitorOptions: workspaceProductMonitorOptions,
  },
};

export const workspaceCoworkCatalog = workspaceCoworkTiers.map(
  (tier) => workspaceCoworkProductsByTier[tier]
);

export const workspaceProductCatalog = workspaceCoworkCatalog;
export const workspaceCoworkProductCatalog = workspaceCoworkCatalog;

export const workspaceProductCoffeePrice: WorkspaceMoney =
  workspaceMoneyFromCurrency(5000, defaultWorkspaceCurrency);

export function getWorkspaceProductByTier(tier: WorkspaceProductTier) {
  return workspaceCoworkProductsByTier[tier];
}

export function isWorkspaceProductTier(
  value: string | undefined
): value is WorkspaceProductTier {
  return isWorkspaceCoworkProductTier(value);
}

export function isWorkspaceCoworkProductTier(
  value: string | undefined
): value is WorkspaceCoworkProductTier {
  return (
    value !== undefined &&
    workspaceCoworkProductTiers.includes(value as WorkspaceCoworkProductTier)
  );
}

export function isWorkspaceProductMonitorOption(
  value: string | undefined
): value is WorkspaceProductMonitorOption {
  return (
    value !== undefined &&
    workspaceProductMonitorOptions.includes(
      value as WorkspaceProductMonitorOption
    )
  );
}

export function formatWorkspaceProductCurrencyAmount(
  product: WorkspaceProductCatalogItem,
  locale: Locale
) {
  return formatWorkspaceMoney(product.price, locale);
}

export function getWorkspaceProductCoffeeLinePriceForTier(
  tier: WorkspaceCoworkProductTier
) {
  if (getWorkspaceProductByTier(tier).includesCourtesyCoffee)
    return {
      ...workspaceProductCoffeePrice,
      value: 0,
    };
  return workspaceProductCoffeePrice;
}

export function getWorkspaceMeetingRoomPriceForDuration(
  duration: MeetingRoomReservationDuration
) {
  return workspaceMeetingRoomProductsByDurationKey[
    getMeetingRoomReservationDurationKey(duration)
  ].price;
}
