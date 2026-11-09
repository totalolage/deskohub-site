// Bun skips dot directories when it collects tests, so the `.well-known`
// route is covered here, next to its handler.

import { describe, expect, mock, test } from "bun:test";

// Outside a request, Next's `connection()` throws; the route calls it so
// the build never prerenders an `Expires` that would age.
const nextServer = await import("next/server");
const connection = mock(() => Promise.resolve());
mock.module("next/server", () => ({ ...nextServer, connection }));

const { GET } = await import("@/app/.well-known/security.txt/route");
const { securityTxt } = await import("./security-txt");

const fields = (body: string) =>
  body
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const separator = line.indexOf(": ");
      return [line.slice(0, separator), line.slice(separator + 2)] as const;
    });

const values = (body: string, name: string) =>
  fields(body)
    .filter(([field]) => field === name)
    .map(([, value]) => value);

describe("security.txt", () => {
  test("serves the contact file as plain text per request", async () => {
    connection.mockClear();
    const response = await GET();

    expect(connection).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8"
    );
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");

    const body = await response.text();
    expect(body.endsWith("\n")).toBe(true);
    for (const [name, value] of fields(body)) {
      expect(name).toMatch(/^[A-Za-z-]+$/);
      expect(value).not.toBe("");
    }
  });

  test("lists an email contact first and a web contact on the site", () => {
    const [email, web] = values(securityTxt(new Date()), "Contact");

    expect(email).toMatch(/^mailto:[^@\s]+@[^@\s]+$/);
    expect(new URL(web ?? "").origin).toBe(
      new URL(values(securityTxt(new Date()), "Canonical")[0] ?? "").origin
    );
  });

  test("expires once, less than a year after the moment it is served", () => {
    const year = 365 * 24 * 60 * 60 * 1000;
    for (const served of [
      "2026-10-21T00:00:00.000Z",
      "2026-10-21T15:30:00.000Z",
      "2026-10-21T23:59:59.999Z",
    ]) {
      const now = new Date(served);
      const expires = values(securityTxt(now), "Expires");

      expect(expires).toEqual(["2027-10-20T00:00:00.000Z"]);
      const expiresAt = Date.parse(expires[0] ?? "");
      expect(expiresAt - now.getTime()).toBeGreaterThan(year - 2 * 86_400_000);
      expect(expiresAt - now.getTime()).toBeLessThan(year);
    }
  });

  test("names its canonical https URL and Czech before English", () => {
    const body = securityTxt(new Date());
    const [canonical] = values(body, "Canonical");

    expect(new URL(canonical ?? "").protocol).toBe("https:");
    expect(new URL(canonical ?? "").pathname).toBe("/.well-known/security.txt");
    expect(values(body, "Preferred-Languages")).toEqual(["cs, en"]);
  });
});
