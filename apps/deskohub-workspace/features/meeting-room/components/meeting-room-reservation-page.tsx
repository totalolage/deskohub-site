import { type Locale, m } from "@/features/i18n";
import { createReservationPage } from "@/features/reservation/components/create-reservation-page.server";
import { meetingRoomReservationPath } from "@/features/reservation/routes";
import {
  MeetingRoomReservationForm,
  MeetingRoomReservationFormFallback,
} from "./meeting-room-reservation-form";

export const meetingRoomReservationPage = createReservationPage({
  kind: "meeting-room",
  pathname: meetingRoomReservationPath,
  metadata: (locale: Locale) => ({
    title: m.reservationMeetingRoomMetadataTitle({}, { locale }),
    description: m.reservationMeetingRoomMetadataDescription({}, { locale }),
  }),
  render: ({ checkoutSessionId, initialReservation, locale }) => ({
    fallback: <MeetingRoomReservationFormFallback locale={locale} />,
    children: (
      <MeetingRoomReservationForm
        checkoutSessionId={checkoutSessionId}
        initialReservation={initialReservation}
        locale={locale}
      />
    ),
  }),
});
