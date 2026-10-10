export interface CampaignSnapshot {
  id: string;
  name: string;
  sourceCampaignId?: string;
  sourceTurn?: number;
  startOrder?: number;
  status: "active" | "paused" | "completed";
  turn: number;
  state: Record<string, unknown>;
}

export function forkCampaign(source: CampaignSnapshot, id: string, name: string, startOrder = source.turn): CampaignSnapshot {
  return {
    id,
    name,
    sourceCampaignId: source.id,
    sourceTurn: source.turn,
    startOrder,
    status: "active",
    turn: 0,
    state: structuredClone(source.state),
  };
}

export function orderCampaigns(campaigns: CampaignSnapshot[]): CampaignSnapshot[] {
  return [...campaigns].sort((a, b) => (a.startOrder ?? 0) - (b.startOrder ?? 0) || a.name.localeCompare(b.name));
}
