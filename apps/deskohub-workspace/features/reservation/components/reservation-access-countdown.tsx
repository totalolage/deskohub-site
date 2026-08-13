"use client";

import { useEffect, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import { formatDuration } from "@/shared/utils/format-duration";

const secondsPerMinute = 60;
const secondsPerHour = 60 * secondsPerMinute;
const secondsPerDay = 24 * secondsPerHour;

const formatDigitalCountdown = (totalSeconds: number) => {
  const hours = Math.floor(totalSeconds / secondsPerHour);
  const minutes = Math.floor(
    (totalSeconds % secondsPerHour) / secondsPerMinute
  );
  const seconds = totalSeconds % secondsPerMinute;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
};

const formatAccessCountdown = (totalSeconds: number, locale: Locale) => {
  let remainingSeconds = totalSeconds;
  const parts = [
    { unit: "day" as const, seconds: secondsPerDay },
    { unit: "hour" as const, seconds: secondsPerHour },
    { unit: "minute" as const, seconds: secondsPerMinute },
    { unit: "second" as const, seconds: 1 },
  ]
    .map(({ unit, seconds }) => {
      const value = Math.floor(remainingSeconds / seconds);
      remainingSeconds %= seconds;
      return { unit, value };
    })
    .filter(({ value }) => value > 0);

  return formatDuration(parts, locale);
};

export function ReservationAccessCountdown({
  availableAt,
  locale,
}: {
  readonly availableAt: string;
  readonly locale: Locale;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState<number>();

  useEffect(() => {
    const deadline = Date.parse(availableAt);
    let intervalId: ReturnType<typeof globalThis.setInterval> | undefined;
    const update = () => {
      const nextRemainingSeconds = Math.max(
        0,
        Math.ceil((deadline - Date.now()) / 1000)
      );
      setRemainingSeconds(nextRemainingSeconds);
      if (nextRemainingSeconds === 0 && intervalId !== undefined) {
        globalThis.clearInterval(intervalId);
      }
    };

    update();
    if (deadline > Date.now()) {
      intervalId = globalThis.setInterval(update, 1000);
    }

    return () => globalThis.clearInterval(intervalId);
  }, [availableAt]);

  if (remainingSeconds === undefined) return null;

  const checking = remainingSeconds === 0;

  return (
    <div className="mt-8 flex justify-center sm:mt-10">
      <div
        aria-label={
          checking
            ? m.reservationAccessChecking({}, { locale })
            : m.reservationAccessUpcomingCountdown(
                { remaining: formatAccessCountdown(remainingSeconds, locale) },
                { locale }
              )
        }
        aria-live="off"
        className="relative grid aspect-square w-[min(18rem,78vw)] place-items-center sm:w-80"
        role="timer"
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0 size-full"
          viewBox="0 0 240 240"
        >
          <circle
            className="text-burned-orange/12"
            cx="120"
            cy="120"
            fill="none"
            r="96"
            stroke="currentColor"
            strokeWidth="18"
          />
          <circle
            className="text-burned-orange/62"
            cx="120"
            cy="120"
            fill="none"
            r="96"
            stroke="currentColor"
            strokeDasharray="434 169"
            strokeLinecap="round"
            strokeWidth="18"
            transform="rotate(-90 120 120)"
          />
        </svg>
        {checking ? (
          <span className="relative max-w-40 text-center text-lg font-semibold text-burned-orange">
            {m.reservationAccessChecking({}, { locale })}
          </span>
        ) : (
          <span className="relative flex flex-col items-center text-center">
            <span className="text-sm font-medium text-navy-blue/60">
              {m.reservationAccessCountdownLabel({}, { locale })}
            </span>{" "}
            <span className="mt-2 font-mono text-[clamp(2rem,9vw,2.75rem)] font-medium tabular-nums tracking-[0.04em] text-navy-blue">
              {formatDigitalCountdown(remainingSeconds)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
