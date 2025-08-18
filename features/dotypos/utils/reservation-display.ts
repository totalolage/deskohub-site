/**
 * Utilities for displaying reservation data from the API
 */

import type { Reservation } from "../generated/types.gen";

/**
 * Parse the note field to extract customer information
 * Handles both pipe-separated and newline-separated formats
 */
export function parseReservationNote(note?: string) {
  if (!note) return {};

  const parsed: Record<string, string | undefined> = {};

  // Try pipe-separated format first (new format)
  if (note.includes(" | ")) {
    const parts = note.split(" | ");
    for (const part of parts) {
      const [key, ...valueParts] = part.split(": ");
      if (key && valueParts.length > 0) {
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
            // Anything else is treated as special requests
            if (!key.includes("Needs") && !parsed.specialRequests) {
              parsed.specialRequests = part;
            }
        }
      }
    }
  } else {
    // Fall back to newline-separated format (old format)
    const lines = note.split("\n");
    for (const line of lines) {
      const [key, ...valueParts] = line.split(": ");
      if (key && valueParts.length > 0) {
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
            parsed.duration = value
              .replace(" hours", "")
              .replace("h", "")
              .trim();
            break;
          case "Special Requests":
            parsed.specialRequests = value;
            break;
        }
      }
    }
  }

  return parsed;
}

/**
 * Convert a reservation from API format to display format
 */
export function getReservationDisplayData(reservation: Reservation) {
  const parsedNote = parseReservationNote(reservation.note);

  // Calculate duration from timestamps if not in note
  let duration: number | undefined;
  if (parsedNote.duration) {
    duration = parseInt(parsedNote.duration, 10);
  } else if (reservation.startDate && reservation.endDate) {
    const startMs = new Date(reservation.startDate).getTime();
    const endMs = new Date(reservation.endDate).getTime();
    const durationMs = endMs - startMs;
    duration = Math.round(durationMs / (1000 * 60 * 60)); // Convert to hours
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
    duration,
    customerName: parsedNote.customerName,
    customerEmail: parsedNote.customerEmail,
    customerPhone: parsedNote.customerPhone,
    needsLargerTable: parsedNote.needsLargerTable === "true",
    needsPrivateSpace: parsedNote.needsPrivateSpace === "true",
    specialRequests: parsedNote.specialRequests,
  };
}

/**
 * Format a date for display
 */
export function formatDateTime(date: Date | undefined, locale: string): string {
  if (!date) return "N/A";

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Format duration for display
 * TODO: This should use i18n translations instead of hardcoded Czech text
 */
export function formatDuration(
  hours: number | undefined,
  _locale: string
): string {
  if (!hours) return "N/A";

  // For now, using simple English format for all locales
  // Should be replaced with proper i18n translations
  const hourText = hours === 1 ? "hour" : "hours";
  return `${hours} ${hourText}`;
}
