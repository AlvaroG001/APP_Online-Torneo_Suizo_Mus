import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

function getLocalNetworkHosts(): string[] {
  const interfaces = networkInterfaces();
  const hosts = new Set<string>();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) {
        continue;
      }

      hosts.add(address.address);
    }
  }

  return [...hosts];
}

const configuredAllowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((value) =>
    value
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/:\d+$/, ""),
  )
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: Array.from(
    new Set([
      "localhost",
      "127.0.0.1",
      ...getLocalNetworkHosts(),
      ...configuredAllowedDevOrigins,
    ]),
  ),
};

export default nextConfig;
