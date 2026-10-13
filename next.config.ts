import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /methodology shows the scoring prompt, read from disk at request time.
  outputFileTracingIncludes: { "/methodology": ["./prompts/**/*"] },
};

export default nextConfig;
