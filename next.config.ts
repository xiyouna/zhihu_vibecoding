import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localNetworkOrigins = Object.values(networkInterfaces())
  .flatMap((interfaces) => interfaces ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address);

const nextConfig: NextConfig = {
  // Next.js protects development assets from cross-origin access. When the
  // server listens on 0.0.0.0, explicitly trust this machine's loopback and
  // active LAN addresses so the client runtime can hydrate on every URL we
  // display to players.
  allowedDevOrigins: ["127.0.0.1", ...localNetworkOrigins],
};

export default nextConfig;
