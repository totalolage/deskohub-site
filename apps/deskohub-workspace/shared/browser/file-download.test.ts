import { describe, expect, test } from "bun:test";
import { getAttachmentFileName } from "./file-download";

const responseWith = (disposition?: string) =>
  new Response("", {
    headers: disposition ? { "Content-Disposition": disposition } : {},
  });

describe("getAttachmentFileName", () => {
  test("reads the quoted file name of an attachment", () => {
    expect(
      getAttachmentFileName(
        responseWith(
          'attachment; filename="deskohub-account-data-2026-11-09.zip"'
        )
      )
    ).toBe("deskohub-account-data-2026-11-09.zip");
  });

  test.each([
    ["no header", undefined],
    ["an attachment without a name", "attachment"],
    ["an unquoted name", "attachment; filename=export.csv"],
  ])("gives none for %s", (_, disposition) => {
    expect(getAttachmentFileName(responseWith(disposition))).toBeUndefined();
  });
});
