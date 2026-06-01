import type {
  WorkspaceProductMonitorOption,
  WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";

type WorkspaceProductMessageKey = keyof typeof m;
type WorkspaceProductTierPerkMarker = "bullet" | "plus";

type WorkspaceProductTierBulletMessageKeys = {
  readonly main: readonly WorkspaceProductMessageKey[];
  readonly perksLabelKey: WorkspaceProductMessageKey;
  readonly perks: readonly {
    readonly key: WorkspaceProductMessageKey;
    readonly highlighted?: boolean;
    readonly marker?: WorkspaceProductTierPerkMarker;
  }[];
};

export const workspaceProductTierMessageKeys = {
  basic: {
    titleKey: "reservationTierBasicTitle",
    descriptionKey: "reservationTierBasicDescription",
  },
  plus: {
    titleKey: "reservationTierCoworkTitle",
    descriptionKey: "reservationTierCoworkDescription",
  },
  profi: {
    titleKey: "reservationTierProfiTitle",
    descriptionKey: "reservationTierProfiDescription",
  },
} as const satisfies Record<
  WorkspaceProductTier,
  {
    readonly titleKey: WorkspaceProductMessageKey;
    readonly descriptionKey: WorkspaceProductMessageKey;
  }
>;

export const workspaceProductTierBulletMessageKeys: Record<
  WorkspaceProductTier,
  WorkspaceProductTierBulletMessageKeys
> = {
  basic: {
    main: ["reservationTierBasicBulletDesk"],
    perksLabelKey: "reservationTierPerksLabel",
    perks: [
      { key: "reservationTierBasicPerkWifi" },
      { key: "reservationTierBasicPerkWater" },
    ],
  },
  plus: {
    main: ["reservationTierCoworkBulletDesk"],
    perksLabelKey: "reservationTierPerksLabel",
    perks: [
      { key: "reservationTierPerkAllBasic", highlighted: true },
      { key: "reservationTierPerkFreeCoffee", marker: "plus" },
    ],
  },
  profi: {
    main: ["reservationTierProfiBulletDesk"],
    perksLabelKey: "reservationTierPerksLabel",
    perks: [
      { key: "reservationTierPerkAllCowork", highlighted: true },
      { key: "reservationTierPerkProSetup", marker: "plus" },
    ],
  },
};

export const workspaceProductMonitorMessageKeys = {
  "2x27-qhd": {
    titleKey: "reservationMonitor2x27QhdTitle",
    descriptionKey: "reservationMonitor2x27QhdDescription",
  },
  "2x32-qhd": {
    titleKey: "reservationMonitor2x32QhdTitle",
    descriptionKey: "reservationMonitor2x32QhdDescription",
  },
  "2x27-4k": {
    titleKey: "reservationMonitor2x27FourKTitle",
    descriptionKey: "reservationMonitor2x27FourKDescription",
  },
  "2x32-4k": {
    titleKey: "reservationMonitor2x32FourKTitle",
    descriptionKey: "reservationMonitor2x32FourKDescription",
  },
} as const satisfies Record<
  WorkspaceProductMonitorOption,
  {
    readonly titleKey: WorkspaceProductMessageKey;
    readonly descriptionKey: WorkspaceProductMessageKey;
  }
>;

export const getWorkspaceProductMessage = (
  key: WorkspaceProductMessageKey,
  locale: Locale
) => {
  const message = m[key] as (
    inputs: object,
    options: { readonly locale: Locale }
  ) => string;

  return message({}, { locale });
};

export const getWorkspaceProductTierTitle = (
  tier: WorkspaceProductTier,
  locale: Locale
) =>
  getWorkspaceProductMessage(
    workspaceProductTierMessageKeys[tier].titleKey,
    locale
  );

export const getWorkspaceProductMonitorTitle = (
  option: WorkspaceProductMonitorOption,
  locale: Locale
) =>
  getWorkspaceProductMessage(
    workspaceProductMonitorMessageKeys[option].titleKey,
    locale
  );
