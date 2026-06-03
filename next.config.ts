import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle for the Docker runtime stage.
  output: 'standalone',
  // Keep the Postgres driver external (required from node_modules at runtime)
  // rather than bundled — avoids pulling node built-ins into bundles.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
