import type {
  WorkspaceCoworkProductTier,
  WorkspaceProductMonitorOption,
} from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";
import {
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";

type WorkspaceProductMessage = (
  inputs: Record<string, never>,
  options: { readonly locale: Locale }
) => string;
type WorkspaceProductTierPerkMarker = "bullet" | "plus";

type WorkspaceProductTierCardMessages = {
  readonly description: WorkspaceProductMessage;
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

export const workspaceProductTierCardMessages: Record<
  WorkspaceCoworkProductTier,
  WorkspaceProductTierCardMessages
> = {
  basic: {
    description: m.reservationTierBasicBulletDesk,
    perksLabel: m.reservationTierPerksLabel,
    perks: [
      { message: m.reservationTierBasicPerkWifi },
      { message: m.reservationTierBasicPerkWater },
    ],
  },
  plus: {
    description: m.reservationTierCoworkBulletDesk,
    perksLabel: m.reservationTierPerksLabel,
    perks: [
      { message: m.reservationTierPerkAllBasic, highlighted: true },
      { message: m.reservationTierPerkFreeCoffee, marker: "plus" },
    ],
  },
  profi: {
    description: m.reservationTierProfiBulletDesk,
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

export const getWorkspaceOfficeProductTitle = (locale: Locale) =>
  getWorkspaceProductMessage(m.reservationOfficeProductTitle, locale);

export const getWorkspaceProductMonitorTitle = (
  option: WorkspaceProductMonitorOption,
  locale: Locale
) =>
  getWorkspaceProductMessage(
    workspaceProductMonitorMessages[option].title,
    locale
  );

export const getWorkspaceMeetingRoomDurationLabel = (
  duration: MeetingRoomReservationDuration,
  locale: Locale
) => {
  if (isMeetingRoomWholeDayReservationDuration(duration)) {
    return m.reservationMeetingRoomDurationWholeDay({}, { locale });
  }

  return m.reservationMeetingRoomDurationHours(
    { count: duration.amount },
    { locale }
  );
};

export const getWorkspaceMeetingRoomDurationTitle = (
  duration: MeetingRoomReservationDuration,
  locale: Locale
) =>
  m.checkoutSummaryItemMeetingRoom(
    {
      duration: getWorkspaceMeetingRoomDurationLabel(duration, locale),
    },
    { locale }
  );
