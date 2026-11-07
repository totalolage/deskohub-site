import { expect, test } from "bun:test";
import { join } from "node:path";

// The mobile app's public/ folder is copied verbatim into its web export, which
// the Workspace serves under /app/.
const mobileApp = join(import.meta.dir, "../../../deskohub-mobile");
const exported = (file: string) => join(mobileApp, "public", file);

type ManifestIcon = { src: string; sizes: string; purpose: string };
type Manifest = {
  id: string;
  start_url: string;
  scope: string;
  display: string;
  icons: ManifestIcon[];
  related_applications: { platform: string; id: string }[];
  prefer_related_applications: boolean;
};

const readManifest = (): Promise<Manifest> =>
  Bun.file(exported("manifest.webmanifest")).json();

/** Width and height from a PNG's IHDR chunk. */
const pngSize = async (path: string) => {
  const view = new DataView(await Bun.file(path).arrayBuffer());
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
};

test("keeps the installed app's identity and scope on /app/", async () => {
  const manifest = await readManifest();

  expect(manifest.id).toBe("/app/");
  expect(manifest.start_url).toBe("/app/");
  expect(manifest.scope).toBe("/app/");
  expect(manifest.display).toBe("standalone");
});

test("ships 192 and 512 px icons for any and maskable use", async () => {
  const { icons } = await readManifest();

  for (const purpose of ["any", "maskable"]) {
    expect(
      icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes)
    ).toEqual(["192x192", "512x512"]);
  }
  for (const icon of icons) {
    expect(icon.src.startsWith("/app/")).toBe(true);
    expect(await pngSize(exported(icon.src.slice("/app/".length)))).toBe(
      icon.sizes
    );
  }
});

test("names the Android app without preferring it over the web app", async () => {
  const manifest = await readManifest();
  const { expo }: { expo: { android: { package: string } } } = await Bun.file(
    join(mobileApp, "app.json")
  ).json();

  expect(manifest.related_applications).toEqual([
    expect.objectContaining({ platform: "play", id: expo.android.package }),
  ]);
  expect(manifest.prefer_related_applications).toBe(false);
});

test("links the manifest and registers the worker for /app/ from the app shell", async () => {
  const shell = await Bun.file(exported("index.html")).text();

  expect(shell).toContain(
    '<link rel="manifest" href="/app/manifest.webmanifest" crossorigin="use-credentials" />'
  );
  expect(shell).toContain(
    'navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" })'
  );
  expect(await Bun.file(exported("sw.js")).exists()).toBe(true);
  expect(await Bun.file(exported("offline.html")).exists()).toBe(true);
});
