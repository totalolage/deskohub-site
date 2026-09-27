import {
  currencyCZK,
  formatWorkspaceMoney,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceMeetingRoomProductsByDurationKey } from "./meeting-room-product-catalog";

export {
  workspaceMeetingRoomCatalog,
  workspaceMeetingRoomProductsByDurationKey,
} from "./meeting-room-product-catalog";

export const workspaceCoworkHistoricalTiers = [
  "basic",
  "plus",
  "profi",
] as const;
export const workspaceCoworkSaleableTiers = [
  "open-space",
  "reserved-desk",
] as const;
export const workspaceCoworkTiers = [
  ...workspaceCoworkHistoricalTiers,
  ...workspaceCoworkSaleableTiers,
] as const;
export const workspaceCoworkProductTiers = workspaceCoworkTiers;
export const workspaceProductTiers = workspaceCoworkTiers;

export const workspaceProductMonitorOptions = [
  "2x27-qhd",
  "2x32-qhd",
  "2x27-4k",
  "2x32-4k",
] as const;

export type WorkspaceCoworkHistoricalTier =
  (typeof workspaceCoworkHistoricalTiers)[number];
export type WorkspaceCoworkSaleableTier =
  (typeof workspaceCoworkSaleableTiers)[number];
export type WorkspaceCoworkProductTier = (typeof workspaceCoworkTiers)[number];
export type WorkspaceProductTier = WorkspaceCoworkProductTier;
export type WorkspaceProductMonitorOption =
  (typeof workspaceProductMonitorOptions)[number];

export type CoworkCoffeeAddonAvailability =
  | "included"
  | "optional"
  | "unavailable";
export type CoworkWorkstationAddonAvailability =
  | "required"
  | "optional"
  | "unavailable";

export const workspaceProductMonitorOptionTableTags = {
  "2x27-qhd": ["monitor:count:2", "monitor:size:27", "monitor:resolution:qhd"],
  "2x32-qhd": ["monitor:count:2", "monitor:size:32", "monitor:resolution:qhd"],
  "2x27-4k": ["monitor:count:2", "monitor:size:27", "monitor:resolution:4k"],
  "2x32-4k": ["monitor:count:2", "monitor:size:32", "monitor:resolution:4k"],
} satisfies Record<WorkspaceProductMonitorOption, readonly string[]>;

export type WorkspaceProductCatalogItem = {
  readonly tier: WorkspaceCoworkProductTier;
  readonly label: string;
  readonly price: WorkspaceMoney;
  readonly saleable: boolean;
  readonly coffeeAddon: CoworkCoffeeAddonAvailability;
  readonly workstationAddon: CoworkWorkstationAddonAvailability;
  readonly allowedMonitorOptions: readonly WorkspaceProductMonitorOption[];
};

const workspaceCoworkProductsByTier = {
  basic: {
    tier: "basic",
    label: "Basic Day Pass",
    price: currencyCZK(35_000),
    saleable: false,
    coffeeAddon: "optional",
    workstationAddon: "unavailable",
    allowedMonitorOptions: [],
  },
  plus: {
    tier: "plus",
    label: "Cowork Plus",
    price: currencyCZK(49_000),
    saleable: false,
    coffeeAddon: "included",
    workstationAddon: "unavailable",
    allowedMonitorOptions: [],
  },
  profi: {
    tier: "profi",
    label: "Profi Workstation",
    price: currencyCZK(55_000),
    saleable: false,
    coffeeAddon: "included",
    workstationAddon: "required",
    allowedMonitorOptions: workspaceProductMonitorOptions,
  },
  "open-space": {
    tier: "open-space",
    label: "Open Space",
    price: currencyCZK(29_000),
    saleable: true,
    coffeeAddon: "optional",
    workstationAddon: "unavailable",
    allowedMonitorOptions: [],
  },
  "reserved-desk": {
    tier: "reserved-desk",
    label: "Reserved Desk",
    price: currencyCZK(41_000),
    saleable: true,
    coffeeAddon: "included",
    workstationAddon: "optional",
    allowedMonitorOptions: workspaceProductMonitorOptions,
  },
} satisfies Record<WorkspaceCoworkProductTier, WorkspaceProductCatalogItem>;

export const workspaceCoworkSaleableCatalog = workspaceCoworkSaleableTiers.map(
  (tier) => workspaceCoworkProductsByTier[tier]
);

export const workspaceCoworkCatalog = workspaceCoworkTiers.map(
  (tier) => workspaceCoworkProductsByTier[tier]
);

export const workspaceProductCatalog = workspaceCoworkCatalog;
export const workspaceCoworkProductCatalog = workspaceCoworkCatalog;

export const workspaceProductCoffeePrice: WorkspaceMoney = currencyCZK(5000);
export const workspaceOfficeBaseDailyPrice: WorkspaceMoney =
  currencyCZK(53_000);
export const workspaceOfficeSeatDailyPrice: WorkspaceMoney =
  currencyCZK(31_500);

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

export function isWorkspaceCoworkSaleableProductTier(
  value: string | undefined
): value is WorkspaceCoworkSaleableTier {
  return (
    value !== undefined &&
    workspaceCoworkSaleableTiers.includes(
      value as WorkspaceCoworkSaleableTier
    )
  );
}

export function getCoworkTierCoffeeAddon(
  tier: WorkspaceCoworkProductTier
): CoworkCoffeeAddonAvailability {
  return getWorkspaceProductByTier(tier).coffeeAddon;
}

export function getCoworkTierWorkstationAddon(
  tier: WorkspaceCoworkProductTier
): CoworkWorkstationAddonAvailability {
  return getWorkspaceProductByTier(tier).workstationAddon;
}

export function getCoworkTierIncludesCourtesyCoffee(
  tier: WorkspaceCoworkProductTier
) {
  return getCoworkTierCoffeeAddon(tier) === "included";
}

export function getCoworkTierRequiresMonitorOption(
  tier: WorkspaceCoworkProductTier
) {
  return getCoworkTierWorkstationAddon(tier) === "required";
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
  if (getCoworkTierIncludesCourtesyCoffee(tier))
    return {
      ...workspaceProductCoffeePrice,
      value: 0,
    };
  return workspaceProductCoffeePrice;
}

export const workspaceProductWorkstationAddonPrice: WorkspaceMoney =
  currencyCZK(12_000);

export function getWorkspaceMeetingRoomPriceForDuration(
  duration: MeetingRoomReservationDuration
) {
  return workspaceMeetingRoomProductsByDurationKey[
    getMeetingRoomReservationDurationKey(duration)
  ].price;
}

export function getWorkspaceOfficePrice(input: {
  readonly seats: number;
  readonly dayCount: number;
}): WorkspaceMoney {
  return currencyCZK(
    (workspaceOfficeBaseDailyPrice.value +
      workspaceOfficeSeatDailyPrice.value * input.seats) *
      input.dayCount
  );
}

export function getWorkspaceOfficeAccessPrice(dayCount: number) {
  return currencyCZK(workspaceOfficeBaseDailyPrice.value * dayCount);
}

export function getWorkspaceOfficeSeatPrice(dayCount: number) {
  return currencyCZK(workspaceOfficeSeatDailyPrice.value * dayCount);
}
