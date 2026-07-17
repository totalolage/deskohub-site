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
        host:
          process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.posthog.com",
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
  cacheComponents: false,
  reactCompiler: true,
  transpilePackages: ["@deskohub/cloudinary", "@deskohub/cloudinary-image"],
  async redirects() {
    return [
      {
        source: `/:locale(${localeRedirectPattern})/reservation`,
        destination: `/:locale/checkout/order?${new URLSearchParams({
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
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
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
