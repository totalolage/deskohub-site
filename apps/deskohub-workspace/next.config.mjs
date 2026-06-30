import { withBotId } from "botid/next/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  cacheComponents: true,
  transpilePackages: ["@deskohub/cloudinary", "@deskohub/cloudinary-image"],
  async redirects() {
    return [
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

export default withBotId(nextConfig);
