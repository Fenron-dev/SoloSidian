export type EntityType =
  | "world"
  | "settlement"
  | "person"
  | "family"
  | "household"
  | "poi"
  | "relationship";

export type RelationshipType =
  | "parent-child"
  | "partner"
  | "sibling"
  | "friend"
  | "rival"
  | "colleague"
  | "resident";

export interface EntityRecord {
  id: string;
  type: EntityType;
  name: string;
  summary: string;
  worldId?: string;
  campaignId?: string;
  seed?: string;
}

export interface RelationshipRecord {
  id: string;
  type: RelationshipType;
  from: string;
  to: string;
  reciprocalType?: RelationshipType;
  worldId?: string;
  campaignId?: string;
  note?: string;
}

export interface GeneratedEntity extends EntityRecord {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

export interface GeneratedSettlement {
  settlement: GeneratedEntity;
  families: GeneratedEntity[];
  households: GeneratedEntity[];
  people: GeneratedEntity[];
  pois: GeneratedEntity[];
  relationships: RelationshipRecord[];
}
