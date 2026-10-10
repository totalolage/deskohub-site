import {
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductMonitorResolution,
  workspaceProductMonitorSetups,
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

export type WorkspaceProductTierCardMessages = {
  readonly description: WorkspaceProductMessage;
  readonly perksLabel: WorkspaceProductMessage;
  readonly perks: readonly {
    readonly message: WorkspaceProductMessage;
    readonly highlighted?: boolean;
    readonly marker?: WorkspaceProductTierPerkMarker;
  }[];
};

export const workspaceProductTierMessages = {
  "open-space": {
    title: m.reservationOpenSpaceTitle,
    description: m.reservationOpenSpaceDescription,
  },
  "reserved-desk": {
    title: m.reservationReservedDeskTitle,
    description: m.reservationReservedDeskDescription,
  },
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
} satisfies Record<
  WorkspaceCoworkProductTier,
  {
    readonly title: WorkspaceProductMessage;
    readonly description: WorkspaceProductMessage;
  }
>;

export const workspaceProductTierCardMessages = {
  "open-space": {
    description: m.reservationOpenSpaceBulletDesk,
    perksLabel: m.reservationTierPerksLabel,
    perks: [{ message: m.reservationOpenSpacePerkWifi }],
  },
  "reserved-desk": {
    description: m.reservationReservedDeskBulletDesk,
    perksLabel: m.reservationTierPerksLabel,
    perks: [
      { message: m.reservationReservedDeskPerkAccess, highlighted: true },
      { message: m.reservationReservedDeskPerkCoffee },
      { message: m.reservationReservedDeskPerkMonitor, marker: "plus" },
    ],
  },
  basic: {
    description: m.reservationTierBasicBulletDesk,
    perksLabel: m.reservationTierPerksLabel,
    perks: [{ message: m.reservationTierBasicPerkWifi }],
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
} satisfies Record<
  WorkspaceCoworkProductTier,
  WorkspaceProductTierCardMessages
>;

export const workspaceProductMonitorDescriptionMessages = {
  "2x27-qhd": m.reservationMonitor2x27QhdDescription,
  "2x32-qhd": m.reservationMonitor2x32QhdDescription,
  "2x27-4k": m.reservationMonitor2x27FourKDescription,
  "2x32-4k": m.reservationMonitor2x32FourKDescription,
} satisfies Record<WorkspaceProductMonitorOption, WorkspaceProductMessage>;

const workspaceProductMonitorResolutionLabels = {
  qhd: "QHD",
  "4k": "4K",
} satisfies Record<WorkspaceProductMonitorResolution, string>;

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
) => {
  const { count, sizeInches, resolution } =
    workspaceProductMonitorSetups[option];

  return m.reservationMonitorSetupTitle(
    {
      count,
      size: new Intl.NumberFormat(locale, {
        style: "unit",
        unit: "inch",
        unitDisplay: "narrow",
      }).format(sizeInches),
      resolution: workspaceProductMonitorResolutionLabels[resolution],
    },
    { locale }
  );
};

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
