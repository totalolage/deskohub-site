import { expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

const redirectUnmatchedFile = (
  path: string,
  headers: Record<string, string> = {}
) =>
  GET(
    new NextRequest(`https://workspace.example/locale-redirect${path}`, {
      headers,
    }),
    {
      params: Promise.resolve({
        path: new URL(path, "https://workspace.example").pathname
          .split("/")
          .slice(1)
          .map(decodeURIComponent),
      }),
    }
  );

test("sends a crawler's unmatched file path to the Czech fallback", async () => {
  const response = await redirectUnmatchedFile("/a/b.php?ref=1");

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://workspace.example/cs-CZ/a/b.php?ref=1"
  );
  expect(response.headers.get("vary")).toBe("Accept-Language");
});

test("sends an unmatched file path to the negotiated locale", async () => {
  const response = await redirectUnmatchedFile("/nope.html", {
    "accept-language": "en",
  });

  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "https://workspace.example/en-US/nope.html"
  );
});

test("keeps an encoded segment encoded", async () => {
  const response = await redirectUnmatchedFile("/a%20b/c.html");

  expect(response.headers.get("location")).toBe(
    "https://workspace.example/cs-CZ/a%20b/c.html"
  );
});

test("moves a bare language prefix to the exact locale", async () => {
  const response = await redirectUnmatchedFile("/en/nope.html", {
    "accept-language": "cs",
  });

  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(
    "https://workspace.example/en-US/nope.html"
  );
});
