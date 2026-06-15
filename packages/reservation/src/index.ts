type ClockTime = {
  hrs: number;
  mins: number;
};

type DailyWorkingHours = {
  open: ClockTime;
  close: ClockTime;
};

export type WeeklyWorkingHours = Record<
  0 | 1 | 2 | 3 | 4 | 5 | 6,
  DailyWorkingHours
>;

type ReservationValidationSettings = {
  minDurationHours: number;
  durationIncrementHours: number;
  fallbackMaxDurationHours: number;
};

export type ReservationScheduleConfig = {
  timezone: string;
  workingHours: WeeklyWorkingHours;
  validation: ReservationValidationSettings;
};

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getLocalTimeInTimezone(
  date: Date,
  timezone: string
): {
  dayOfWeek: number;
  hours: number;
  minutes: number;
  timeString: string;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const weekdayPart = parts.find((part) => part.type === "weekday");
  const hourPart = parts.find((part) => part.type === "hour");
  const minutePart = parts.find((part) => part.type === "minute");

  if (!weekdayPart || !hourPart || !minutePart) {
    throw new Error("Failed to parse reservation datetime components");
  }

  const dayOfWeek = weekdayMap[weekdayPart.value] ?? 0;
  const hours = Number.parseInt(hourPart.value, 10);
  const minutes = Number.parseInt(minutePart.value, 10);
  const timeString = `${hourPart.value}:${minutePart.value}`;

  return { dayOfWeek, hours, minutes, timeString };
}

function minutesFromClockTime(clockTime: ClockTime): number {
  if (clockTime.hrs === 24) {
    return 24 * 60;
  }

  return clockTime.hrs * 60 + clockTime.mins;
}

export function isReservationWithinWorkingHours(
  datetime: Date,
  durationHours: number,
  config: ReservationScheduleConfig
): boolean {
  const startTime = getLocalTimeInTimezone(datetime, config.timezone);
  const endDateTime = new Date(
    datetime.getTime() + durationHours * 60 * 60 * 1000
  );
  const endTime = getLocalTimeInTimezone(endDateTime, config.timezone);

  const dayHours =
    config.workingHours[startTime.dayOfWeek as keyof WeeklyWorkingHours];
  const openTimeInMinutes = minutesFromClockTime(dayHours.open);
  const closeTimeInMinutes = minutesFromClockTime(dayHours.close);
  const startTimeInMinutes = startTime.hours * 60 + startTime.minutes;

  if (
    startTimeInMinutes < openTimeInMinutes ||
    startTimeInMinutes >= closeTimeInMinutes
  ) {
    return false;
  }

  if (endTime.dayOfWeek !== startTime.dayOfWeek) {
    return false;
  }

  const endTimeInMinutes = endTime.hours * 60 + endTime.minutes;
  return endTimeInMinutes <= closeTimeInMinutes;
}

export function getAvailableDurations(
  datetime: Date | null,
  config: ReservationScheduleConfig
): number[] {
  const { minDurationHours, durationIncrementHours, fallbackMaxDurationHours } =
    config.validation;

  if (!datetime) {
    const options: number[] = [];
    for (
      let hours = minDurationHours;
      hours <= fallbackMaxDurationHours;
      hours += durationIncrementHours
    ) {
      options.push(hours);
    }
    return options;
  }

  const { dayOfWeek, hours, minutes } = getLocalTimeInTimezone(
    datetime,
    config.timezone
  );
  const dayHours = config.workingHours[dayOfWeek as keyof WeeklyWorkingHours];
  const currentMinutes = hours * 60 + minutes;
  const openingMinutes = minutesFromClockTime(dayHours.open);
  const closingMinutes = minutesFromClockTime(dayHours.close);

  if (currentMinutes < openingMinutes || currentMinutes >= closingMinutes) {
    return [];
  }

  const minutesUntilClosing = closingMinutes - currentMinutes;
  if (minutesUntilClosing < minDurationHours * 60) {
    return [];
  }

  const maxHours = Math.floor((minutesUntilClosing / 60) * 2) / 2;
  const options: number[] = [];

  for (
    let duration = minDurationHours;
    duration <= maxHours;
    duration += durationIncrementHours
  ) {
    options.push(duration);
  }

  return options;
}
