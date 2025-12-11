import { expect, test } from "bun:test";

import { createNoteWithMetadata, parseNoteWithMetadata } from "./note-metadata";

test("createNoteWithMetadata", () => {
  const note = createNoteWithMetadata("Special requests", {
    locale: "en-US",
    source: "website",
    timestamp: "2023-01-01T00:00:00Z",
  });

  expect(note).toBe(
    `Special requests


----------------------------------------
METADATA
locale: en-US
source: website
timestamp: 2023-01-01T00:00:00Z
----------------------------------------`
  );
});

test("parseNoteWithMetadata", () => {
  const note = createNoteWithMetadata("Special requests", {
    locale: "en-US",
    source: "website",
    timestamp: "2023-01-01T00:00:00Z",
  });

  const parsed = parseNoteWithMetadata(note);

  expect(parsed.specialRequests).toBe("Special requests");
  expect(parsed.metadata).toEqual({
    locale: "en-US",
    source: "website",
    timestamp: "2023-01-01T00:00:00Z",
  });
});
