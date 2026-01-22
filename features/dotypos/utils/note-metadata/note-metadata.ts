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

import superjson from "superjson";
import type { Locale } from "@/features/i18n";
import type { TableReservationFormData } from "@/features/table-reservation";

export interface NoteMetadata {
  locale?: Locale;
  source?: string;
  timestamp?: string;
  [key: string]: string | undefined; // Allow additional metadata fields
}

const FORMDATA_HEADER = "---------- FORM DATA START ----------";
const FORMDATA_END = "----------- FORM DATA END -----------";

export interface NoteData extends TableReservationFormData {
  timestamp: Date;
  locale: Locale;
  source: "website";
}

/**
 * Create a note with embedded metadata
 *
 * @param input - Table reservation form data
 * @param metadata - Metadata to embed in the note
 * @returns Formatted note string with metadata
 */
export function createNoteWithMetadata(
  textContents: string | null | undefined,
  data: NoteData
): string {
  return [
    ...(textContents ? [textContents, "", ""] : []),
    FORMDATA_HEADER,
    // encryptAES256GCM(superjson.stringify(data), env.FORM_DATA_ENC_SECRET),
    superjson.stringify(data),
    FORMDATA_END,
  ].join("\n");
}

/**
 * Parse a note to extract special requests and metadata
 *
 * @param note - The note string from Dotypos
 * @returns Parsed note with special requests and metadata
 */
export function parseNoteWithMetadata(
  note: string | null | undefined
): NoteData | null {
  if (!note) return null;

  const formDataText: string[] = [];
  let inFormData = false;
  for (const line of note.split("\n")) {
    switch (line) {
      case FORMDATA_HEADER:
        inFormData = true;
        continue;
      case FORMDATA_END:
        inFormData = false;
        continue;
    }

    // Parsing form data lines
    if (inFormData) formDataText.push(line);
  }

  // const encryptedFormData = formDataText.join("\n");
  // const decryptedFormData = decryptAES256GCM(
  //   encryptedFormData,
  //   env.FORM_DATA_ENC_SECRET
  // )
  //
  // const formData = superjson.parse(decryptedFormData) as NoteData;
  const formData = superjson.parse(formDataText.join("\n")) as NoteData;
  return formData;
}
