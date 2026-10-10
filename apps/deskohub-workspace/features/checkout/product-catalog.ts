import { Record } from "effect";
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
export const workspaceCoworkCurrentTiers = [
  "open-space",
  "reserved-desk",
] as const;
export const workspaceCoworkTiers = [
  ...workspaceCoworkHistoricalTiers,
  ...workspaceCoworkCurrentTiers,
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
export type WorkspaceCoworkCurrentTier =
  (typeof workspaceCoworkCurrentTiers)[number];
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

export type WorkspaceProductMonitorResolution = "qhd" | "4k";

export type WorkspaceProductMonitorSetup = {
  readonly count: number;
  readonly sizeInches: number;
  readonly resolution: WorkspaceProductMonitorResolution;
};

export const workspaceProductMonitorSetups = {
  "2x27-qhd": { count: 2, sizeInches: 27, resolution: "qhd" },
  "2x32-qhd": { count: 2, sizeInches: 32, resolution: "qhd" },
  "2x27-4k": { count: 2, sizeInches: 27, resolution: "4k" },
  "2x32-4k": { count: 2, sizeInches: 32, resolution: "4k" },
} satisfies Record<WorkspaceProductMonitorOption, WorkspaceProductMonitorSetup>;

export const workspaceProductMonitorOptionTableTags = Record.map(
  workspaceProductMonitorSetups,
  ({ count, sizeInches, resolution }): readonly string[] => [
    `monitor:count:${count}`,
    `monitor:size:${sizeInches}`,
    `monitor:resolution:${resolution}`,
  ]
);

export type WorkspaceProductCatalogItem = {
  readonly tier: WorkspaceCoworkProductTier;
  readonly label: string;
  readonly price: WorkspaceMoney;
  readonly coffeeAddon: CoworkCoffeeAddonAvailability;
  readonly workstationAddon: CoworkWorkstationAddonAvailability;
  readonly allowedMonitorOptions: readonly WorkspaceProductMonitorOption[];
};

const workspaceCoworkProductsByTier = {
  basic: {
    tier: "basic",
    label: "Basic Day Pass",
    price: currencyCZK(35_000),
    coffeeAddon: "optional",
    workstationAddon: "unavailable",
    allowedMonitorOptions: [],
  },
  plus: {
    tier: "plus",
    label: "Cowork Plus",
    price: currencyCZK(49_000),
    coffeeAddon: "included",
    workstationAddon: "unavailable",
    allowedMonitorOptions: [],
  },
  profi: {
    tier: "profi",
    label: "Profi Workstation",
    price: currencyCZK(55_000),
    coffeeAddon: "included",
    workstationAddon: "required",
    allowedMonitorOptions: workspaceProductMonitorOptions,
  },
  "open-space": {
    tier: "open-space",
    label: "Open Space",
    price: currencyCZK(29_000),
    coffeeAddon: "optional",
    workstationAddon: "unavailable",
    allowedMonitorOptions: [],
  },
  "reserved-desk": {
    tier: "reserved-desk",
    label: "Reserved Desk",
    price: currencyCZK(41_000),
    coffeeAddon: "included",
    workstationAddon: "optional",
    allowedMonitorOptions: workspaceProductMonitorOptions,
  },
} satisfies Record<WorkspaceCoworkProductTier, WorkspaceProductCatalogItem>;

export const workspaceCoworkCurrentCatalog = workspaceCoworkCurrentTiers.map(
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

export function isWorkspaceCoworkCurrentProductTier(
  value: string | undefined
): value is WorkspaceCoworkCurrentTier {
  return (
    value !== undefined &&
    workspaceCoworkCurrentTiers.includes(value as WorkspaceCoworkCurrentTier)
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
