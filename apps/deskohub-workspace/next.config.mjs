import inlangSettings from "./project.inlang/settings.json" with {
  type: "json",
};
import { withBotId } from "botid/next/config";
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
  experimental: {
    // `next build` holds 4–5 GB on Vercel's 8 GB build machine until a few
    // seconds after compiling, while the page-data and static-generation workers
    // start at up to 1 GB each. Three workers left 0.8 GB free and two 0.2 GB.
    cpus: 1,
    // Next's TS CLI integration needs bin tsc, which the official TS6 wrapper (tsc6-only) must not provide.
    useTypeScriptCli: false,
    // Turbopack's build filesystem cache is on by default; the separate
    // `build:compile` and `build:generate` tasks keep writing it apart from
    // prerendering to fit Vercel's 8 GB machine.
    // Garbage collection drops unreachable work from it, which slows its growth
    // toward Vercel's 1.5 GB build-cache limit, past which Vercel discards it.
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
  // The `typecheck` task runs the native compiler before `build:compile`.
  // Next's own check runs the TS6 compiler in a worker that needs 3–3.5 GB beside
  // the `next build` process, so it hung or got OOM-killed on Vercel.
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    "@deskohub/cloudinary",
    "@deskohub/cloudinary-image",
    "@deskohub/workspace-admin-api",
  ],
  async redirects() {
    return [
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
