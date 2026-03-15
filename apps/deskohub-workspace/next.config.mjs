/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    useCache: true,
  },
  async redirects() {
    return [
      {
        source: "/bar",
        destination: "https://www.deskohub.cz",
        permanent: true,
      },
      {
        source: "/:locale(en-US|cs-CZ)/bar",
        destination: "https://www.deskohub.cz",
        permanent: true,
      },
      {
        source: "/bar/:path*",
        destination: "https://www.deskohub.cz/:path*",
        permanent: true,
      },
      {
        source: "/:locale(en-US|cs-CZ)/bar/:path*",
        destination: "https://www.deskohub.cz/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
