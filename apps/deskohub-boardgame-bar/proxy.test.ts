import { expect, test } from "bun:test";
import { config } from "./proxy";

const regexpSrcObj = Array.isArray(config.matcher)
  ? config.matcher[0]
  : config.matcher;

const regexpSrc =
  typeof regexpSrcObj === "string" ? regexpSrcObj : regexpSrcObj?.source;

if (!regexpSrc) process.exit(1);

test("regexp source starts with /", () => {
  expect(regexpSrc.startsWith("/")).toBeTrue();
});

test("regexp source does not hardcode icon paths", () => {
  [
    "icon\\.ico",
    "apple-touch-icon\\.png",
    "app-icon\\.png",
    "favicon\\.ico",
  ].forEach((path) => {
    expect(regexpSrc.includes(path)).toBeFalse();
  });
});

const regexp = new RegExp(regexpSrc);

test("regexp matches normal application routes", () => {
  const shouldMatch = [
    "/", // root
    "/home",
    "/about",
    "/blog",
    "/blog/my-post",
    "/products",
    "/products/123",
    "/users/john_doe",
    "/nested/path/with/many/segments",

    // Looks similar to reserved prefixes, but should still be allowed:
    "/images2/logo.png",
    "/apiary",
    "/_nextish/asset.js",
    "/.well-knownish/thing",

    // Contains 'icon' but NOT considered an icon asset by spec:
    "/static/iconography.png",
    "/assets/bigiconography.svg",
    "/static/myiconfont.woff2",

    // Uppercase / weird names:
    "/foo/ICON.txt",
    "/icons/collection/app.svg",
  ];

  for (const path of shouldMatch) {
    expect(path).toMatch(regexp);
  }

  const shouldMatchWithDomain = shouldMatch.map(
    (path) => `https://example.com${path}`
  );

  for (const path of shouldMatchWithDomain) {
    expect(path).toMatch(regexp);
  }
});

test("regexp does NOT match icon asset routes", () => {
  const shouldNotMatch = [
    "/icon.png", // <== IMPORTANT: spec says this must NOT match
    "/favicon.ico",
    "/apple-icon.png",
    "/apple-touch-icon.png",
    "/apple-touch-icon-120x120.png",
    "/android-icon-192x192.png",
    "/static/app-icon.svg",
    "/assets/logo_icon.webp",
    "/assets/logo-icon.webp",
    "/some/path/very-nice-icon.jpeg",
    "/pwa-icon-512x512.png",
    "/mask-icon.svg",
  ];

  for (const path of shouldNotMatch) {
    expect(path).not.toMatch(regexp);
  }
});

test("regexp does NOT match framework/special routes", () => {
  const shouldNotMatch = [
    "/_next",
    "/_next/static/chunk.js",
    "/_next/image?url=%2Ffoo.png",
    "/api",
    "/api/user",
    "/api/v1/users",
    "/images",
    "/images/logo.png",
    "/images/icons/icon-192.png",
    "/.well-known",
    "/.well-known/security.txt",
    "/.well-known/assetlinks.json",
  ];

  for (const path of shouldNotMatch) {
    expect(path).not.toMatch(regexp);
  }
});
