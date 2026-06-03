import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the Docker runtime stage.
  output: 'standalone',
};

export default nextConfig;
