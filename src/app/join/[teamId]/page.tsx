import { MobileJoinForm } from "@/components/mobile-join-form";
import { readTournamentState } from "@/lib/store";
import { refreshTournamentState } from "@/lib/tournament";

export const dynamic = "force-dynamic";

export default async function LegacyJoinPage() {
  const state = refreshTournamentState(await readTournamentState());
  return <MobileJoinForm initialState={state} />;
}
