import {
  formatWorkspaceMoney,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";
import type { Locale } from "@/features/i18n";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDuration,
  type MeetingRoomReservationDurationKey,
  meetingRoomReservationDurations,
} from "@/features/reservation/meeting-room-reservation-duration";

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

export const workspaceCoworkCatalog: readonly WorkspaceProductCatalogItem[] = [
  {
    tier: "basic",
    label: "Basic Day Pass",
    price: { value: 35_000, exponent: 2, currency: "CZK" },
    includesCourtesyCoffee: false,
    requiresCoffee: false,
    requiresMonitorOption: false,
    allowedMonitorOptions: [],
  },
  {
    tier: "plus",
    label: "Cowork Plus",
    price: { value: 49_000, exponent: 2, currency: "CZK" },
    includesCourtesyCoffee: true,
    requiresCoffee: true,
    requiresMonitorOption: false,
    allowedMonitorOptions: [],
  },
  {
    tier: "profi",
    label: "Profi Workstation",
    price: { value: 55_000, exponent: 2, currency: "CZK" },
    includesCourtesyCoffee: true,
    requiresCoffee: true,
    requiresMonitorOption: true,
    allowedMonitorOptions: workspaceProductMonitorOptions,
  },
];

export const workspaceProductCatalog = workspaceCoworkCatalog;
export const workspaceCoworkProductCatalog = workspaceCoworkCatalog;

const workspaceMeetingRoomPrices = {
  "hour:1": { value: 47_500, exponent: 2, currency: "CZK" },
  "hour:4": { value: 155_000, exponent: 2, currency: "CZK" },
  "day:1": { value: 232_000, exponent: 2, currency: "CZK" },
} as const satisfies Record<MeetingRoomReservationDurationKey, WorkspaceMoney>;

export const workspaceMeetingRoomCatalog = meetingRoomReservationDurations.map(
  (duration) => ({
    duration,
    price:
      workspaceMeetingRoomPrices[
        getMeetingRoomReservationDurationKey(duration)
      ],
  })
);

export const workspaceProductCoffeePrice: WorkspaceMoney = {
  value: 5000,
  exponent: 2,
  currency: "CZK",
};

const productsByTier = new Map<
  WorkspaceCoworkProductTier,
  WorkspaceProductCatalogItem
>(workspaceCoworkCatalog.map((product) => [product.tier, product]));

type WorkspaceMeetingRoomCatalogItem =
  (typeof workspaceMeetingRoomCatalog)[number];

const meetingRoomProductsByDuration = new Map<
  MeetingRoomReservationDurationKey,
  WorkspaceMeetingRoomCatalogItem
>(
  workspaceMeetingRoomCatalog.map((product) => [
    getMeetingRoomReservationDurationKey(product.duration),
    product,
  ])
);

if (productsByTier.size !== workspaceProductTiers.length) {
  throw new Error(
    "Workspace product catalog must cover every reservation tier"
  );
}

if (meetingRoomProductsByDuration.size !== workspaceMeetingRoomCatalog.length) {
  throw new Error(
    "Workspace meeting-room catalog must contain unique duration products"
  );
}

function getWorkspaceMeetingRoomProductByDuration(
  duration: MeetingRoomReservationDuration
) {
  const product = meetingRoomProductsByDuration.get(
    getMeetingRoomReservationDurationKey(duration)
  );

  if (!product) {
    throw new Error("Unknown workspace meeting-room duration");
  }

  return product;
}

export function getWorkspaceProductByTier(tier: WorkspaceProductTier) {
  const product = productsByTier.get(tier);

  if (!product) {
    throw new Error(`Unknown workspace checkout product tier: ${tier}`);
  }

  return product;
}

export function isWorkspaceProductTier(
  value: string | undefined
): value is WorkspaceProductTier {
  return (
    value !== undefined && productsByTier.has(value as WorkspaceProductTier)
  );
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
  return getWorkspaceMeetingRoomProductByDuration(duration).price;
}
