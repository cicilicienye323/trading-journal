import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually reached at runtime. This is what lets the Docker
  // image be ~200MB instead of shipping the whole dependency tree.
  //
  // Vercel ignores this and uses its own build pipeline — the Dockerfile is for
  // local parity and as evidence of container competence, not the deploy path.
  output: "standalone",
};

export default nextConfig;
