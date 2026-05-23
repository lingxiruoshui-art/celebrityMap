export interface Person {
  id: number;
  name: string;
  category: string;
  keyword?: string;
  lifespan?: string;
  birthplace?: string;
  views: number;
  biography: string;
  achievements: string; // JSON string from DB
  image_url: string | null;
  raw_relationships?: string;
  wikidata_id?: string | null;
  created_at?: string;
}

export interface Relationship {
  id: number;
  person1_id: number;
  person2_id: number;
  relationship_type: string;
}

export interface ArchiveData {
  people: Person[];
  relationships: Relationship[];
}
