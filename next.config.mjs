/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Optimize cache behavior
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
