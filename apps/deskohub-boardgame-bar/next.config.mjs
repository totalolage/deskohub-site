import { withBotId } from "botid/next/config";

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
    return [
      {
        source: '/workspace',
        destination: 'https://workspace.deskohub.cz',
        permanent: true,
      },
      {
        source: '/workspace/:path*',
        destination: 'https://workspace.deskohub.cz/:path*',
        permanent: true,
      },
    ];
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
