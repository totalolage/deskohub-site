import inlangSettings from "./project.inlang/settings.json" with {
  type: "json",
};
import { join } from "node:path";
import { withBotId } from "botid/next/config";
import { assertMobileWebAppExported } from "./features/mobile-web-app/mobile-web-app-export.js";
import { configureWorkspaceBotId } from "./shared/bot-protection/bot-protection.policy.js";

const localeRedirectPattern = inlangSettings.locales.join("|");
const workspaceBotIdVercelEnvironment =
  process.env.VERCEL_ENV ?? "development";

/**
 * WebMCP origin-trial tokens from a comma-separated list, for the production
 * origin only.
 *
 * @param {string | undefined} value
 */
const parseOriginTrialTokens = (value) =>
  (value ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheLife: {
    advertisedPricingSources: {
      stale: 30,
      revalidate: 60,
      expire: 60 * 60 * 8,
    },
    publicContent: { stale: 30, revalidate: 60, expire: 300 },
    // Advisory availability inputs; bookings re-check live provider data.
    availabilityTables: {
      stale: 30,
      revalidate: 60 * 30,
      expire: 60 * 60 * 24,
    },
    availabilityCalendar: {
      stale: 30,
      revalidate: 60 * 30,
      expire: 60 * 60 * 6,
    },
    availabilityReservations: { stale: 30, revalidate: 60, expire: 60 * 10 },
    // Reservation details customers and their agents read; statuses come from
    // Workspace rows, so a stale entry only delays a provider-side change.
    reservationRecords: { stale: 30, revalidate: 60, expire: 60 * 5 },
  },
  cacheComponents: true,
  compiler: {
    // `next typegen` loads this config for a production build too, so the
    // check waits for a real compile.
    runAfterProductionCompile: async ({ projectDir }) =>
      assertMobileWebAppExported(join(projectDir, "public/app")),
  },
  experimental: {
    // `next build` holds 4–5 GB on Vercel's 8 GB build machine until a few
    // seconds after compiling, while the page-data and static-generation workers
    // start at up to 1 GB each. Three workers left 0.8 GB free and two 0.2 GB.
    cpus: 1,
    // Next's TS CLI integration needs bin tsc, which the official TS6 wrapper (tsc6-only) must not provide.
    useTypeScriptCli: false,
    // Vercel's build cache holds every `node_modules` (about 1 GB compressed)
    // and `.next/cache`, and Vercel drops all of it past 1.5 GB. Turbopack's
    // build filesystem cache (`.next/cache/turbopack`, about 0.8 GB) doesn't fit
    // beside them, so with it on every build ran cold, installs included.
    // `build:compile` deletes a restored copy, which Next would keep.
    turbopackFileSystemCacheForBuild: false,
    // Garbage collection drops unreachable work from `next dev`'s cache.
    turbopackGc: true,
    // Customer avatar uploads carry up to 2 MiB of raw image bytes plus the
    // Server Action / multipart envelope, so the 1 MiB default body limit is
    // too small; oversized images are rejected by the avatar policy itself.
    serverActions: {
      bodySizeLimit: "4mb",
    },
    exposeTestingApiInProductionBuild:
      workspaceBotIdVercelEnvironment === "preview",
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  partialPrefetching: true,
  // `build:source-maps` uploads production browser source maps to PostHog and
  // deletes them before generation, so they are never deployed.
  productionBrowserSourceMaps: process.env.VERCEL_ENV === "production",
  reactCompiler: true,
  // The app installed under /app/ has the scope `/app/`, which Next's built-in
  // redirect would strip to `/app`. `redirects()` repeats that redirect for
  // every other path.
  skipTrailingSlashRedirect: true,
  // Pull request CI and the production release workflow run the native compiler
  // (`typecheck`); the Vercel build itself doesn't type-check.
  // Next's own check runs the TS6 compiler in a worker that needs 3–3.5 GB beside
  // the `next build` process, so it hung or got OOM-killed on Vercel.
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@deskohub/cloudinary",
    "@deskohub/cloudinary-image",
    "@deskohub/workspace-admin-api",
    "@deskohub/workspace-customer-api",
  ],
  async redirects() {
    return [
      {
        source: "/:path((?!app(?:/|$)).+)/",
        destination: "/:path",
        permanent: true,
      },
      {
        source: `/:locale(${localeRedirectPattern})/reservation`,
        destination: `/:locale/reservation/cowork?${new URLSearchParams({
          utm_source: "qr",
          utm_medium: "print",
          utm_campaign: "bud jako doma",
        })}`,
        permanent: true,
      },
      {
        source: "/bar",
        destination: "https://www.deskohub.cz",
        permanent: true,
      },
      {
        source: "/:locale/bar",
        destination: "https://www.deskohub.cz/:locale",
        permanent: true,
      },
      {
        source: "/bar/:path*",
        destination: "https://www.deskohub.cz/:path*",
        permanent: true,
      },
      {
        source: "/:locale/bar/:path*",
        destination: "https://www.deskohub.cz/:locale/:path*",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [],
      // The proxy skips dotted paths, so it can't tell an unmatched one from a
      // root file. Once every file and non-dynamic route has had its turn, a
      // dotted path outside the locales, their RSC requests, `/api`, the static
      // map framings and the build assets gets the locale redirect the proxy
      // gives other unprefixed paths. Otherwise the `[locale]` route would take
      // its first segment for a locale and answer with Next's bare error
      // document. Route matching ignores letter case, so this rewrite also
      // skips a dotted path under a wrong-case locale (`/en-us/x.html`); the
      // proxy's matcher catches that one and moves it to the exact locale.
      afterFiles: [
        // The mobile web export is one page that routes on the client, so
        // every undotted path under /app/ that isn't a file loads it.
        {
          source: "/app/:path([^.]*)",
          destination: "/app/index.html",
        },
        {
          source: `/:path((?!(?:${localeRedirectPattern})(?:/|$|\\.(?:prefetch\\.)?rsc$|\\.segments/)|api/|_next/|_vercel/|page-markdown/|workspace-location-map/).*\\..*)`,
          destination: "/locale-redirect/:path",
        },
      ],
      fallback: [],
    };
  },
  async headers() {
    const originTrialTokens = parseOriginTrialTokens(
      process.env.WEBMCP_ORIGIN_TRIAL_TOKENS
    );

    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer",
          },
        ],
      },
      {
        // Crawlable but kept out of search: robots.txt must not block it, or
        // crawlers never see this header.
        source: "/app/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
      ...(originTrialTokens.length > 0
        ? [
            {
              // Pages only: API routes and build assets never run site tools.
              source: "/((?!api/|_next/).*)",
              headers: [
                {
                  // One comma-separated header: Vercel and Next.js keep a single
                  // value per header key, and Chromium accepts comma-separated
                  // tokens in one `Origin-Trial` header.
                  key: "Origin-Trial",
                  value: originTrialTokens.join(", "),
                },
              ],
            },
          ]
        : []),
    ];
  },
  images: {
    // AVIF cuts the hero by about 15% and the cowork artwork by over half
    // against WebP. It encodes slower, but only on a cache miss: local images
    // stay cached across deployments.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
};

export default configureWorkspaceBotId(
  nextConfig,
  workspaceBotIdVercelEnvironment,
  withBotId
);
