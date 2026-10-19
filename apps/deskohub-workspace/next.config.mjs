import { withPostHogConfig } from "@posthog/nextjs-config";
import inlangSettings from "./project.inlang/settings.json" with {
  type: "json",
};
import { withBotId } from "botid/next/config";
import { configureWorkspaceBotId } from "./shared/bot-protection/bot-protection.policy.js";

const localeRedirectPattern = inlangSettings.locales.join("|");
const workspaceBotIdVercelEnvironment =
  process.env.VERCEL_ENV ?? "development";

const postHogSourceMapConfig =
  process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID
    ? {
        personalApiKey: process.env.POSTHOG_API_KEY,
        projectId: process.env.POSTHOG_PROJECT_ID,
        host: process.env.POSTHOG_API_HOST,
        sourcemaps: {
          enabled: process.env.VERCEL_ENV === "production",
          releaseName: "deskohub-workspace",
          ...(process.env.VERCEL_GIT_COMMIT_SHA
            ? { releaseVersion: process.env.VERCEL_GIT_COMMIT_SHA }
            : {}),
          deleteAfterUpload: true,
        },
      }
    : undefined;

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
  },
  cacheComponents: true,
  experimental: {
    // `next build` holds 4–5 GB on Vercel's 8 GB build machine until a few
    // seconds after compiling, while the page-data and static-generation workers
    // start at up to 1 GB each. Three workers left 0.8 GB free and two 0.2 GB.
    cpus: 1,
    // Next's TS CLI integration needs bin tsc, which the official TS6 wrapper (tsc6-only) must not provide.
    useTypeScriptCli: false,
    // With the build cache on, Turbopack keeps about 5 GB resident while it
    // persists the cache during prerendering, so a cold build exceeds Vercel's
    // 8 GB build machine. The cache also pushes Vercel's build cache past its
    // 1.5 GB limit.
    turbopackFileSystemCacheForBuild: false,
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
  reactCompiler: true,
  // The build script type-checks with the native compiler before `next build`.
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

const botIdConfig = configureWorkspaceBotId(
  nextConfig,
  workspaceBotIdVercelEnvironment,
  withBotId
);

export default postHogSourceMapConfig
  ? withPostHogConfig(botIdConfig, postHogSourceMapConfig)
  : botIdConfig;
