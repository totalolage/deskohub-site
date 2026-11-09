import { type Locale, m } from "@/features/i18n";

/** The meeting room's specifications in `locale`, in page order. */
export const getMeetingRoomSpecifications = (locale: Locale) =>
  [
    {
      number: "01",
      text: m.meetingRoomSpecCapacityText({}, { locale }),
      title: m.meetingRoomSpecCapacityTitle({}, { locale }),
    },
    {
      number: "02",
      text: m.meetingRoomSpecTvText({}, { locale }),
      title: m.meetingRoomSpecTvTitle({}, { locale }),
    },
    {
      number: "03",
      text: m.meetingRoomSpecProjectorText({}, { locale }),
      title: m.meetingRoomSpecProjectorTitle({}, { locale }),
    },
    {
      number: "04",
      text: m.meetingRoomSpecConferenceText({}, { locale }),
      title: m.meetingRoomSpecConferenceTitle({}, { locale }),
    },
  ] as const;
