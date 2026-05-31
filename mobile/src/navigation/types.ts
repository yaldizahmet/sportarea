export type RootStackParamList = {
  Auth: undefined;
  Dashboard: { user: Record<string, unknown> };
  Profile: { user: Record<string, unknown> };
  Leaderboard: { user: Record<string, unknown> };
  MatchDetails: { match: Record<string, unknown>; user: Record<string, unknown> };
  GroupDetails: { group: Record<string, unknown>; user: Record<string, unknown> };
  Availability: { user: Record<string, unknown> };
};
