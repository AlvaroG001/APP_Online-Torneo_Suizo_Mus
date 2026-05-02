import { networkInterfaces } from "node:os";
import { headers } from "next/headers";
import { TournamentFlow } from "@/components/tournament-flow";
import { readTournamentState } from "@/lib/store";
import { refreshTournamentState } from "@/lib/tournament";

export const dynamic = "force-dynamic";

function getLocalIpv4Hosts(): string[] {
  const hosts = new Set<string>();

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        hosts.add(address.address);
      }
    }
  }

  return [...hosts];
}

export default async function Home() {
  const state = refreshTournamentState(await readTournamentState());
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const protocol = headersList.get("x-forwarded-proto") ?? "http";
  const port = host.includes(":") ? `:${host.split(":").at(-1)}` : "";
  const networkBaseUrls = getLocalIpv4Hosts().map(
    (address) => `${protocol}://${address}${port}`,
  );

  return <TournamentFlow initialState={state} networkBaseUrls={networkBaseUrls} />;
}
