import type {
  WorkspaceCoworkProductTier,
  WorkspaceMeetingRoomDurationMinutes,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";

type WorkspaceProductMessage = (
  inputs: Record<string, never>,
  options: { readonly locale: Locale }
) => string;
type WorkspaceProductTierPerkMarker = "bullet" | "plus";

type WorkspaceProductTierBulletMessages = {
  readonly main: readonly WorkspaceProductMessage[];
  readonly perksLabel: WorkspaceProductMessage;
  readonly perks: readonly {
    readonly message: WorkspaceProductMessage;
    readonly highlighted?: boolean;
    readonly marker?: WorkspaceProductTierPerkMarker;
  }[];
};

export const workspaceProductTierMessages: Record<
  WorkspaceCoworkProductTier,
  {
    readonly title: WorkspaceProductMessage;
    readonly description: WorkspaceProductMessage;
  }
> = {
  basic: {
    title: m.reservationTierBasicTitle,
    description: m.reservationTierBasicDescription,
  },
  plus: {
    title: m.reservationTierCoworkTitle,
    description: m.reservationTierCoworkDescription,
  },
  profi: {
    title: m.reservationTierProfiTitle,
    description: m.reservationTierProfiDescription,
  },
};

export const workspaceProductTierBulletMessages: Record<
  WorkspaceCoworkProductTier,
  WorkspaceProductTierBulletMessages
> = {
  basic: {
    main: [m.reservationTierBasicBulletDesk],
    perksLabel: m.reservationTierPerksLabel,
    perks: [
      { message: m.reservationTierBasicPerkWifi },
      { message: m.reservationTierBasicPerkWater },
    ],
  },
  plus: {
    main: [m.reservationTierCoworkBulletDesk],
    perksLabel: m.reservationTierPerksLabel,
    perks: [
      { message: m.reservationTierPerkAllBasic, highlighted: true },
      { message: m.reservationTierPerkFreeCoffee, marker: "plus" },
    ],
  },
  profi: {
    main: [m.reservationTierProfiBulletDesk],
    perksLabel: m.reservationTierPerksLabel,
    perks: [
      { message: m.reservationTierPerkAllCowork, highlighted: true },
      { message: m.reservationTierPerkProSetup, marker: "plus" },
    ],
  },
};

export const workspaceProductMonitorMessages: Record<
  WorkspaceProductMonitorOption,
  {
    readonly title: WorkspaceProductMessage;
    readonly description: WorkspaceProductMessage;
  }
> = {
  "2x27-qhd": {
    title: m.reservationMonitor2x27QhdTitle,
    description: m.reservationMonitor2x27QhdDescription,
  },
  "2x32-qhd": {
    title: m.reservationMonitor2x32QhdTitle,
    description: m.reservationMonitor2x32QhdDescription,
  },
  "2x27-4k": {
    title: m.reservationMonitor2x27FourKTitle,
    description: m.reservationMonitor2x27FourKDescription,
  },
  "2x32-4k": {
    title: m.reservationMonitor2x32FourKTitle,
    description: m.reservationMonitor2x32FourKDescription,
  },
};

export const getWorkspaceProductMessage = (
  message: WorkspaceProductMessage,
  locale: Locale
) => message({}, { locale });

export const getWorkspaceProductTierTitle = (
  tier: WorkspaceCoworkProductTier,
  locale: Locale
) =>
  getWorkspaceProductMessage(workspaceProductTierMessages[tier].title, locale);

export const getWorkspaceMeetingRoomProductTitle = (locale: Locale) =>
  getWorkspaceProductMessage(m.reservationTierMeetingRoomTitle, locale);

export const getWorkspaceProductMonitorTitle = (
  option: WorkspaceProductMonitorOption,
  locale: Locale
) =>
  getWorkspaceProductMessage(
    workspaceProductMonitorMessages[option].title,
    locale
  );

export const getWorkspaceMeetingRoomDurationTitle = (
  durationMinutes: WorkspaceMeetingRoomDurationMinutes,
  locale: Locale
) =>
  m.checkoutSummaryItemMeetingRoom(
    {
      duration: m.reservationMeetingRoomDurationHours(
        { count: durationMinutes / 60 },
        { locale }
      ),
    },
    { locale }
  );
