import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits .next/standalone with a self-contained server.js and only the
  // node_modules actually reached at runtime. This is what lets the Docker
  // image be ~200MB instead of shipping the whole dependency tree.
  //
  // Off on Vercel. The previous comment here asserted "Vercel ignores this",
  // which was never verified and is the leading suspect for the deploy failing
  // in Vercel's own post-build step with
  //   ENOENT ... .next/next-server.js.nft.json
  // Standalone is documented as a self-hosting/Docker feature: it rearranges
  // the build output, and Vercel does its own tracing and packaging over the
  // standard layout. Nothing here needs it on Vercel.
  //
  // Vercel sets VERCEL=1 on every build. Docker and CI never do, so the
  // container image — the only consumer of .next/standalone — is unaffected.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
