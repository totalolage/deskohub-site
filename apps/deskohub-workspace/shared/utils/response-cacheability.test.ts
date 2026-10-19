import { expect, test } from "bun:test";
import { isReusableBySharedCache } from "./response-cacheability";

const response = (status: number, cacheControl?: string) =>
  new Response(null, {
    headers: cacheControl ? { "Cache-Control": cacheControl } : {},
    status,
  });

test("reuses successful responses that allow shared caching", () => {
  expect(isReusableBySharedCache(response(200))).toBe(true);
  expect(isReusableBySharedCache(response(200, "public, max-age=604800"))).toBe(
    true
  );
});

test("does not reuse responses that forbid shared caching", () => {
  expect(isReusableBySharedCache(response(200, "no-cache"))).toBe(false);
  expect(isReusableBySharedCache(response(200, "public, No-Store"))).toBe(
    false
  );
  expect(isReusableBySharedCache(response(200, 'private="Set-Cookie"'))).toBe(
    false
  );
});

test("does not reuse failed responses", () => {
  expect(isReusableBySharedCache(response(403))).toBe(false);
  expect(isReusableBySharedCache(response(503, "max-age=60"))).toBe(false);
});
