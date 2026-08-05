import { type Locale, m } from "@/features/i18n";

type MeetingRoomSpecificationsProps = {
  locale: Locale;
};

export function MeetingRoomSpecifications({
  locale,
}: MeetingRoomSpecificationsProps) {
  const specifications = [
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

  return (
    <section
      aria-labelledby="meeting-room-specifications-heading"
      className="border-t border-white/10 bg-white/[0.035]"
    >
      <div className="mx-auto grid w-full max-w-8xl gap-14 px-4 py-24 sm:px-6 sm:py-32 lg:grid-cols-[minmax(16rem,0.58fr)_minmax(0,1.42fr)] lg:gap-[clamp(4rem,8vw,8.125rem)] lg:px-8 xl:px-14">
        <div>
          <p className="mb-7 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-sunset-yellow">
            {m.meetingRoomSpecificationsEyebrow({}, { locale })}
          </p>
          <h2
            className="text-[clamp(3.125rem,5.4vw,5.75rem)] leading-[0.96] tracking-[-0.06em]"
            id="meeting-room-specifications-heading"
          >
            {m.meetingRoomSpecificationsTitle({}, { locale })}
          </h2>
          <p className="mt-8 max-w-[27.5rem] leading-[1.65] text-silver/76">
            {m.meetingRoomSpecificationsIntro({}, { locale })}
          </p>
        </div>

        <div className="border-t border-white/18">
          {specifications.map((specification) => (
            <article
              className="grid min-h-32 grid-cols-[2.375rem_1fr] items-start gap-3 border-b border-white/18 py-7 sm:grid-cols-[3.5rem_minmax(11.25rem,0.72fr)_minmax(13.75rem,1fr)] sm:items-center sm:gap-6 sm:py-5"
              key={specification.number}
            >
              <span className="font-mono text-[0.625rem] text-sunset-yellow">
                {specification.number}
              </span>
              <h3 className="text-2xl tracking-[-0.035em] sm:text-[clamp(1.5rem,2.1vw,2.125rem)]">
                {specification.title}
              </h3>
              <p className="col-start-2 m-0 leading-[1.6] text-silver/76 sm:col-auto">
                {specification.text}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
