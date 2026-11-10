import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import { connection } from "next/server";
import { type Locale, m } from "@/features/i18n";
import { isMeetingRoomPageOpenAfterConnection } from "@/features/meeting-room/backend/meeting-room-page-release-gate.server";
import { textLink } from "@/shared/components/ui/text-link";

/** Points the Workspace room's visitors at the meeting room it is, while that page is out. */
export async function MeetingRoomNote({ locale }: { locale: Locale }) {
  await connection();
  if (!(await isMeetingRoomPageOpenAfterConnection())) return null;

  return (
    <p>
      <Interpolate
        string={m.ttrpgRoomMeetingRoomNote({}, { locale })}
        mapping={{
          meetingRoom: (content) => (
            <Link href={`/${locale}/meeting-room`} className={textLink()}>
              {content}
            </Link>
          ),
        }}
      />
    </p>
  );
}
