import { describe, expect, test } from "bun:test";
import { removeUrlCredentials } from "./url-credentials";

describe("removeUrlCredentials", () => {
  test("strips embedded Basic credentials and keeps the location", () => {
    expect(
      removeUrlCredentials(
        "https://admin:secret@workspace.deskohub.cz/admin/reservations/1?tab=a#history"
      )
    ).toBe("https://workspace.deskohub.cz/admin/reservations/1?tab=a#history");
  });

  test("strips a username without a password", () => {
    expect(
      removeUrlCredentials("https://admin@workspace.deskohub.cz/admin")
    ).toBe("https://workspace.deskohub.cz/admin");
  });

  test("returns null for URLs without credentials", () => {
    expect(
      removeUrlCredentials("https://workspace.deskohub.cz/admin")
    ).toBeNull();
  });
});
