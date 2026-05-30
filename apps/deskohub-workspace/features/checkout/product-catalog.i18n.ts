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
  "basic-day-pass": {
    titleKey: "reservationTierBasicTitle",
    descriptionKey: "reservationTierBasicDescription",
  },
  "cowork-plus": {
    titleKey: "reservationTierCoworkTitle",
    descriptionKey: "reservationTierCoworkDescription",
  },
  "profi-workstation": {
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
  "basic-day-pass": {
    main: ["reservationTierBasicBulletDesk"],
    perksLabelKey: "reservationTierPerksLabel",
    perks: [
      { key: "reservationTierBasicPerkWifi" },
      { key: "reservationTierBasicPerkWater" },
    ],
  },
  "cowork-plus": {
    main: ["reservationTierCoworkBulletDesk"],
    perksLabelKey: "reservationTierPerksLabel",
    perks: [
      { key: "reservationTierPerkAllBasic", highlighted: true },
      { key: "reservationTierPerkFreeCoffee", marker: "plus" },
    ],
  },
  "profi-workstation": {
    main: ["reservationTierProfiBulletDesk"],
    perksLabelKey: "reservationTierPerksLabel",
    perks: [
      { key: "reservationTierPerkAllCowork", highlighted: true },
      { key: "reservationTierPerkProSetup", marker: "plus" },
    ],
  },
};

export const workspaceProductMonitorMessageKeys = {
  "2x27": {
    titleKey: "reservationMonitor2x27Title",
    descriptionKey: "reservationMonitor2x27Description",
  },
  "2x32": {
    titleKey: "reservationMonitor2x32Title",
    descriptionKey: "reservationMonitor2x32Description",
  },
  "qhd-4k": {
    titleKey: "reservationMonitorQhd4kTitle",
    descriptionKey: "reservationMonitorQhd4kDescription",
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
