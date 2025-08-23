/**
 * Note Metadata Utilities
 *
 * Functions to encode and decode metadata in Dotypos reservation notes.
 * The note field contains the user's special requests followed by metadata.
 *
 * Format:
 * [User's special requests]
 *
 * ----------------------------------------
 * METADATA
 * locale: en-US
 * source: website
 * timestamp: 2024-01-27T10:30:00Z
 * ----------------------------------------
 */

import type { Locale } from "@/i18n";

export interface NoteMetadata {
  locale?: Locale;
  source?: string;
  timestamp?: string;
  [key: string]: string | undefined; // Allow additional metadata fields
}

export interface ParsedNote {
  specialRequests: string;
  metadata: NoteMetadata;
}

const METADATA_SEPARATOR = "\n\n----------------------------------------";
const METADATA_HEADER = "METADATA";
const METADATA_END = "----------------------------------------";

/**
 * Create a note with embedded metadata
 *
 * @param specialRequests - User's special requests (can be empty)
 * @param metadata - Metadata to embed in the note
 * @returns Formatted note string with metadata
 */
export function createNoteWithMetadata(
  specialRequests: string | undefined,
  metadata: NoteMetadata
): string {
  const metadataLines: string[] = [];

  // Add metadata header
  metadataLines.push(METADATA_HEADER);

  // Add each metadata field
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined && value !== null && value !== "") {
      metadataLines.push(`${key}: ${value}`);
    }
  }

  // If no metadata, just return the special requests
  if (metadataLines.length === 1) {
    return specialRequests || "";
  }

  // Combine special requests with metadata
  const parts: string[] = [];

  if (specialRequests?.trim()) {
    parts.push(specialRequests.trim());
  }

  parts.push(METADATA_SEPARATOR);
  parts.push(...metadataLines);
  parts.push(METADATA_END);

  return parts.join("\n");
}

/**
 * Parse a note to extract special requests and metadata
 *
 * @param note - The note string from Dotypos
 * @returns Parsed note with special requests and metadata
 */
export function parseNoteWithMetadata(
  note: string | null | undefined
): ParsedNote {
  const parsedNote: ParsedNote = {
    specialRequests: "",
    metadata: {},
  };
  if (!note) return parsedNote;

  parsedNote.specialRequests = note.trim();

  // Check if the note contains metadata separator
  const separatorIndex = note.indexOf(METADATA_SEPARATOR);

  if (separatorIndex === -1) return parsedNote;

  // Extract special requests (everything before the separator)
  parsedNote.specialRequests = note.substring(0, separatorIndex).trim();

  // Extract metadata section
  const metadataSection = note.substring(
    separatorIndex + METADATA_SEPARATOR.length
  );

  // Parse metadata
  const lines = metadataSection.split("\n");

  let inMetadata = false;
  for (const line of lines) {
    const trimmedLine = line.trim();

    // Start of metadata
    if (trimmedLine === METADATA_HEADER) {
      inMetadata = true;
      continue;
    }

    // End of metadata
    if (trimmedLine === METADATA_END) {
      break;
    }

    // Parse metadata line
    if (inMetadata && trimmedLine) {
      const colonIndex = trimmedLine.indexOf(":");
      if (colonIndex > 0) {
        const key = trimmedLine.substring(0, colonIndex).trim();
        const value = trimmedLine.substring(colonIndex + 1).trim();
        if (key && value) {
          // Special handling for locale to ensure it's a valid Locale type
          if (key === "locale" && (value === "cs-CZ" || value === "en-US")) {
            parsedNote.metadata.locale = value as Locale;
          } else if (key !== "locale") {
            parsedNote.metadata[key] = value;
          }
        }
      }
    }
  }

  return parsedNote;
}

/**
 * Update metadata in an existing note while preserving special requests
 *
 * @param existingNote - The existing note from Dotypos
 * @param newMetadata - New metadata to merge with existing
 * @returns Updated note string
 */
export function updateNoteMetadata(
  existingNote: string | null | undefined,
  newMetadata: NoteMetadata
): string {
  const parsed = parseNoteWithMetadata(existingNote);

  // Merge metadata
  const mergedMetadata = {
    ...parsed.metadata,
    ...newMetadata,
  };

  return createNoteWithMetadata(parsed.specialRequests, mergedMetadata);
}

/**
 * Helper function to create standard metadata for a new reservation
 *
 * @param locale - User's locale
 * @param source - Source of the reservation (e.g., "website", "app", "admin")
 * @returns Standard metadata object
 */
export function createStandardMetadata(
  locale: Locale,
  source: "website"
): NoteMetadata {
  return {
    locale,
    source,
    timestamp: new Date().toISOString(),
  };
}
