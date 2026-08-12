"use client";

import { useEffect, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import { formatDuration } from "@/shared/utils/format-duration";

const secondsPerMinute = 60;
const secondsPerHour = 60 * secondsPerMinute;
const secondsPerDay = 24 * secondsPerHour;

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

  return (
    <p
      aria-live="off"
      className="mt-6 text-xl font-bold text-burned-orange sm:text-2xl"
      role="timer"
    >
      {remainingSeconds === 0
        ? m.reservationAccessChecking({}, { locale })
        : m.reservationAccessUpcomingCountdown(
            { remaining: formatAccessCountdown(remainingSeconds, locale) },
            { locale }
          )}
    </p>
  );
}
