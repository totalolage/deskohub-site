import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(scriptDirectory, "../public");
const buildTag = process.env.DW_BUILD_TAG?.trim() || "development";
const buildChannel =
  process.env.DW_BUILD_CHANNEL === "production" ? "production" : "preview";
const certificateDigest = process.env.EXPO_PUBLIC_ANDROID_CERT_SHA256?.trim()
  .replaceAll(":", "")
  .toUpperCase();
const certificateFingerprint = certificateDigest?.match(/.{2}/g)?.join(":");

await mkdir(path.join(publicDirectory, ".well-known"), { recursive: true });
await Promise.all([
  copyFile(
    path.resolve(scriptDirectory, "../assets/images/favicon.png"),
    path.join(publicDirectory, "icon-256.png")
  ),
  copyFile(
    path.resolve(scriptDirectory, "../assets/images/icon.png"),
    path.join(publicDirectory, "icon-1024.png")
  ),
]);

const webManifest = {
  id: "/",
  name: "Deskohub Workspace",
  short_name: "DW",
  description: "Workspace shop",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#F8F9FA",
  theme_color: "#9C4400",
  lang: "cs",
  categories: ["business", "food"],
  icons: [
    { src: "/icon-256.png", sizes: "256x256", type: "image/png" },
    {
      src: "/icon-1024.png",
      sizes: "1024x1024",
      type: "image/png",
      purpose: "any maskable",
    },
  ],
};
await writeFile(
  path.join(publicDirectory, "manifest.webmanifest"),
  `${JSON.stringify(webManifest, null, 2)}\n`
);

if (buildChannel === "production") {
  if (
    !certificateFingerprint ||
    !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(certificateFingerprint)
  ) {
    throw new Error(
      "Production PWA builds require EXPO_PUBLIC_ANDROID_CERT_SHA256 in colon-delimited form"
    );
  }
  const assetLinks = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "cz.deskohub.workspace",
        sha256_cert_fingerprints: [certificateFingerprint],
      },
    },
  ];
  await writeFile(
    path.join(publicDirectory, ".well-known/assetlinks.json"),
    `${JSON.stringify(assetLinks, null, 2)}\n`
  );
}

const serviceWorker = `const CACHE_NAME = ${JSON.stringify(`deskohub-workspace-${buildTag}`)};
const STATIC_DESTINATIONS = new Set(["font", "image", "script", "style"]);
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-256.png", "/icon-1024.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/").then((cached) => cached || Response.error())));
    return;
  }
  if (!STATIC_DESTINATIONS.has(request.destination)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const refreshed = fetch(request).then((response) => {
      if (response.ok && response.type === "basic") void cache.put(request, response.clone());
      return response;
    });
    return cached || refreshed;
  })());
});
`;

await writeFile(path.join(publicDirectory, "service-worker.js"), serviceWorker);
