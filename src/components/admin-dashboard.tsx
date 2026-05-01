import { TournamentFlow } from "@/components/tournament-flow";
import type { TournamentState } from "@/lib/tournament";

interface AdminDashboardProps {
  initialState: TournamentState;
}

export function AdminDashboard({ initialState }: AdminDashboardProps) {
  return <TournamentFlow initialState={initialState} />;
}
