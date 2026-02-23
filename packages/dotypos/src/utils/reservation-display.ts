import type { Reservation } from "../generated/types.gen";

export function parseReservationNote(note?: string) {
  if (!note) return {};

  const parsed: Record<string, string | undefined> = {};

  if (note.includes(" | ")) {
    for (const part of note.split(" | ")) {
      const [key, ...valueParts] = part.split(": ");
      if (!key || valueParts.length === 0) continue;

      const value = valueParts.join(": ").trim();
      switch (key) {
        case "Customer":
          parsed.customerName = value;
          break;
        case "Email":
          parsed.customerEmail = value;
          break;
        case "Phone":
          parsed.customerPhone = value;
          break;
        case "Duration":
          parsed.duration = value.replace("h", "").trim();
          break;
        case "Needs larger table":
          parsed.needsLargerTable = value === "Yes" ? "true" : "false";
          break;
        case "Needs private space":
          parsed.needsPrivateSpace = value === "Yes" ? "true" : "false";
          break;
        default:
          if (!key.includes("Needs") && !parsed.specialRequests) {
            parsed.specialRequests = part;
          }
      }
    }

    return parsed;
  }

  for (const line of note.split("\n")) {
    const [key, ...valueParts] = line.split(": ");
    if (!key || valueParts.length === 0) continue;

    const value = valueParts.join(": ").trim();
    switch (key) {
      case "Customer":
        parsed.customerName = value;
        break;
      case "Email":
        parsed.customerEmail = value;
        break;
      case "Phone":
        parsed.customerPhone = value;
        break;
      case "Needs larger table":
        parsed.needsLargerTable = value === "Yes" ? "true" : "false";
        break;
      case "Needs private space":
        parsed.needsPrivateSpace = value === "Yes" ? "true" : "false";
        break;
      case "Duration":
        parsed.duration = value.replace(" hours", "").replace("h", "").trim();
        break;
      case "Special Requests":
        parsed.specialRequests = value;
        break;
    }
  }

  return parsed;
}

export function getReservationDisplayData(reservation: Reservation) {
  let durationMinutes: number | undefined;
  if (reservation.startDate && reservation.endDate) {
    const startMs = new Date(reservation.startDate).getTime();
    const endMs = new Date(reservation.endDate).getTime();
    durationMinutes = Math.round((endMs - startMs) / (1000 * 60));
  }

  return {
    id: String(reservation.id),
    status: reservation.status?.toLowerCase() || "pending",
    createdAt: reservation.created ? new Date(reservation.created) : undefined,
    datetime: reservation.startDate
      ? new Date(reservation.startDate)
      : undefined,
    endDate: reservation.endDate ? new Date(reservation.endDate) : undefined,
    guestCount:
      typeof reservation.seats === "string"
        ? parseInt(reservation.seats, 10) || 1
        : reservation.seats || 1,
    durationMinutes,
    specialRequests: reservation.note || "",
  };
}

export function formatDateTime(date: Date | undefined, locale: string): string {
  if (!date) return "N/A";

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDuration(
  hours: number | undefined,
  _locale: string
): string {
  if (!hours) return "N/A";

  const hourText = hours === 1 ? "hour" : "hours";
  return `${hours} ${hourText}`;
}
