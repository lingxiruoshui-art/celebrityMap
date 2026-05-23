CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  keyword TEXT,
  lifespan TEXT,
  birthplace TEXT,
  biography TEXT NOT NULL,
  achievements TEXT NOT NULL,
  image_url TEXT,
  views INTEGER DEFAULT 0,
  raw_relationships TEXT DEFAULT '[]',
  wikidata_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person1_id INTEGER NOT NULL,
  person2_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  FOREIGN KEY(person1_id) REFERENCES people(id),
  FOREIGN KEY(person2_id) REFERENCES people(id),
  UNIQUE(person1_id, person2_id)
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS guest_usage (
  ip TEXT,
  date TEXT,
  count INTEGER,
  PRIMARY KEY(ip, date)
);
