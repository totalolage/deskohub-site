import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { getCliSessionsNotice } from "./cli-sessions-notice";

describe("getCliSessionsNotice", () => {
  test("confirms a revoked session in the route locale", () => {
    expect(getCliSessionsNotice("revoked", "cs-CZ")).toEqual({
      message: m.adminCliSessionsRevokedNotice({}, { locale: "cs-CZ" }),
      status: "success",
    });
  });

  test("reports a revocation that changed nothing as an error", () => {
    expect(getCliSessionsNotice("unchanged", "en-US")).toEqual({
      message: m.adminCliSessionsUnchangedNotice({}, { locale: "en-US" }),
      status: "error",
    });
  });

  test("shows no notice without a known result", () => {
    expect(getCliSessionsNotice(undefined, "en-US")).toBeUndefined();
    expect(getCliSessionsNotice("granted", "en-US")).toBeUndefined();
  });
});
