import { withBotId } from "botid/next/config";
import { redirects } from "./next-config/redirects.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@deskohub/cloudinary",
    "@deskohub/cloudinary-image",
    "@deskohub/dotypos",
    "@deskohub/email",
    "@deskohub/games",
    "@deskohub/reservation",
  ],
  experimental: {
    // Next's TS CLI integration needs bin tsc, which the official TS6 wrapper (tsc6-only) must not provide; API-worker type checking still runs.
    useTypeScriptCli: false,
    useCache: true,
  },
  async redirects() {
    return redirects;
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "cf.geekdo-images.com",
      },
    ],
  },
};

export default withBotId(nextConfig);
