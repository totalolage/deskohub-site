import { withBotId } from "botid/next/config";
import { redirects } from "./next-config/redirects.mjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@deskohub/cloudinary",
    "@deskohub/cloudinary-image",
    "@deskohub/dotypos",
    "@deskohub/email",
    "@deskohub/reservation",
  ],
  experimental: {
    useCache: true,
  },
  async redirects() {
    return redirects;
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
    ],
  },
};

export default withBotId(nextConfig);
