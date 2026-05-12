import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Fallback to .env.example only if not in production and variables are missing
if (process.env.NODE_ENV !== "production") {
  const envExamplePath = path.join(process.cwd(), ".env.example");
  if (fs.existsSync(envExamplePath)) {
    const exampleConfig = dotenv.parse(fs.readFileSync(envExamplePath));
    for (const k in exampleConfig) {
      if (!process.env[k] || process.env[k] === "") {
        process.env[k] = exampleConfig[k];
      }
    }
  }
}

import { CATEGORIES, FIGURE_POOL } from "./src/figuresPool.ts";

const db = new Database("celebrity_graph.sqlite");

// Enable WAL mode for better performance and to prevent "database is locked" errors
db.pragma("journal_mode = WAL");

db.exec(`
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
    latitude REAL DEFAULT 0,
    longitude REAL DEFAULT 0,
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
`);

// ==== Config Helpers ====
const getConfig = (key: string, defaultValue: string = "") => {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as any;
  if (!row || row.value === null || row.value === undefined) return defaultValue;
  return String(row.value);
};
const setConfig = (key: string, value: string) => {
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};

// ==== Usage Tracker Helpers ====
function getCSTDate(): string {
    // Current server time is likely UTC. Beijing is UTC+8.
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const cstTime = new Date(utcTime + (8 * 3600000));
    return cstTime.toISOString().split('T')[0];
}

function getRemainingQuota(): number {
    const limit = parseInt(getConfig("guest_explore_limit", "5"), 10);
    const date = getCSTDate();
    const row = db.prepare("SELECT count FROM guest_usage WHERE ip = 'GLOBAL_GUEST' AND date = ?").get(date) as any;
    const used = row ? row.count : 0;
    return Math.max(0, limit - used);
}

function incrementUsage() {
    const date = getCSTDate();
    db.prepare(`
        INSERT INTO guest_usage (ip, date, count) 
        VALUES ('GLOBAL_GUEST', ?, 1) 
        ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
    `).run(date);
}

// AI Helper function supporting Gemini and Aliyun
async function callAI(prompt: string, responseFormat: "text" | "json" = "text", schema?: any): Promise<string> {
  const provider = getConfig("active_model_provider", "gemini");
  
  if (provider === "aliyun") {
    const apiKey = getConfig("aliyun_api_key");
    const modelId = getConfig("aliyun_model_id");
    if (!apiKey) throw new Error("缺少 Aliyun API Key，请在设置中配置。");
    if (!modelId) throw new Error("缺少 Aliyun 模型 ID，请在设置中配置。");
    
    // Aliyun's compatible mode supports response_format for some models, but to be broadly compatible,
    // we omit the response_format property and rely entirely on markdown stripping. Let's send the request.
    const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: "你是一个历史学和百科知识专家。当被要求返回 JSON 时，请严格遵守指定的 schema，且只返回 JSON 原始内容，不要包含任何 Markdown 格式或额外的前后文解释。" },
          { role: "user", content: prompt }
        ]
      })
    });
    
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Aliyun API error: ${err}`);
    }
    const json = await res.json() as any;
    let content = json.choices[0].message.content || "";
    if (responseFormat === "json") {
       const start = content.indexOf('{');
       const end = content.lastIndexOf('}');
       if (start !== -1 && end !== -1 && end >= start) {
         content = content.substring(start, end + 1);
       } else {
         content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
       }
    }
    return content;
  } else {
    const apiKey = getConfig("gemini_api_key") || process.env.GEMINI_API_KEY;
    const modelId = getConfig("gemini_model_id") || process.env.GEMINI_MODEL_ID || "gemini-1.5-flash";
    if (!apiKey) throw new Error("缺少 Gemini API Key，请在设置中配置。");
    if (!modelId) throw new Error("缺少 Gemini 模型 ID，请在设置中配置。");
    
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: responseFormat === "json" ? { 
        responseMimeType: "application/json",
        responseSchema: schema 
      } : undefined
    });
    let content = result.text || "";
    if (responseFormat === "json") {
       const start = content.indexOf('{');
       const end = content.lastIndexOf('}');
       if (start !== -1 && end !== -1 && end >= start) {
         content = content.substring(start, end + 1);
       } else {
         content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
       }
    }
    return content;
  }
}

function getFallbackSeedData(name: string) {
    if (name === "苏格拉底") {
        return {
            category: "哲学家",
            keyword: "未经审视的生活是不值得过的。",
            lifespan: "公元前470年—公元前399年",
            birthplace: "古希腊雅典",
            biography: "苏格拉底，古希腊著名的思想家、哲学家、教育家，西方哲学的奠基者。\n\n他一生未曾留下任何文字著作，他的思想通过其门徒柏拉图的对话录得以流传。苏格拉底创立了“产婆术”辩论法。最终，他被雅典法庭以“不敬神明”和“蛊惑青年”的罪名判处死刑，但他为了维护法律的尊严，从容饮下毒堇汁而死。",
            achievements: ["西方哲学奠基人", "创立“产婆术”（苏格拉底反诘法）", "确立了西方哲学的道德和伦理研究方向"],
            image_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Socrates_Louvre.jpg/500px-Socrates_Louvre.jpg",
            relationships: [
                { personName: "柏拉图", relationshipType: "柏拉图是苏格拉底最杰出的学生，他通过对话录完美的传承并升华了导师的哲学思想。" },
                { personName: "亚里士多德", relationshipType: "亚里士多德作为柏拉图的学生，间接受到苏格拉底怀疑精神的影响，共同构成了希腊三贤。" }
            ],
            latitude: 37.9838,
            longitude: 23.7275
        };
    } else if (name === "柏拉图") {
        return {
            category: "哲学家",
            keyword: "知识是灵魂的食粮。",
            lifespan: "约公元前428年—公元前348年",
            birthplace: "古希腊雅典",
            biography: "柏拉图（约公元前428年—公元前348年），古希腊伟大的哲学家，苏格拉底的学生，亚里士多德的老师。他出身雅典贵族，早年立志从政，但在目睹恩师苏格拉底被民主政体判处死刑后，对雅典政治深感绝望，转而毕生潜心哲学。\n\n他在雅典创办了著名的“阿卡德米”学园，这是西方最早的高等学府之一。柏拉图的大量对话录是西方思想史的瑰宝，其中《理想国》更是对西方政治思想产生了极为深远的影响。他的“理念论”构成了西方客观唯心主义的基础。",
            achievements: ["西方客观唯心主义的创始人", "创办雅典学院（阿卡德米）", "撰写《理想国》《会饮篇》等经典哲学对话录"],
            image_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/88/Plato_Silanion_Musei_Capitolini_MC1377.jpg/500px-Plato_Silanion_Musei_Capitolini_MC1377.jpg",
            relationships: [
                { personName: "苏格拉底", relationshipType: "柏拉图极度崇敬导师苏格拉底，并在其作品中赋予了苏格拉底永恒的哲学灵魂。" },
                { personName: "亚里士多德", relationshipType: "亚里士多德在柏拉图的学园学习二十年，两人虽有理念分歧，但师生情谊深厚。" }
            ],
            latitude: 37.9838,
            longitude: 23.7275
        };
    }
    return { category: "其他", keyword: "伟大人物", lifespan: "", birthplace: "", biography: "暂无传记", achievements: [], image_url: "", relationships: [], latitude: 0, longitude: 0 };
}

async function seedDatabase() {
  const migrations = [
    "ALTER TABLE people ADD COLUMN latitude REAL DEFAULT 0",
    "ALTER TABLE people ADD COLUMN longitude REAL DEFAULT 0",
    "ALTER TABLE people ADD COLUMN image_url TEXT",
    "ALTER TABLE people ADD COLUMN lifespan TEXT",
    "ALTER TABLE people ADD COLUMN birthplace TEXT"
  ];

  for (const m of migrations) {
    try {
      db.exec(m);
    } catch (e) {
      // Column might already exist
    }
  }

  // Not seeding initial figures automatically as per user request.
  // The first user will create initial people through space-time exploration.
  console.log("Database initialized. Ready for initial user data entry.");
}
seedDatabase();

async function getPortraitUrl(name: string): Promise<string | null> {
  const headers = { 
    "User-Agent": "HistoricalArchiveApp/1.0 (historical-archive-app; developer@example.com)" 
  };
  try {
    const searchWikidata = async (lang: string) => {
      const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&format=json`;
      const res = await fetch(searchUrl, { headers });
      const data = await res.json() as any;
      return data.search?.[0];
    };

    let entity = await searchWikidata("zh");
    if (!entity) entity = await searchWikidata("en");
    
    if (entity) {
      const entityId = entity.id;
      const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=claims&format=json`;
      const entityRes = await fetch(entityUrl, { headers });
      const entityData = await entityRes.json() as any;
      
      const claims = entityData.entities[entityId].claims;
      if (claims.P18 && claims.P18.length > 0) {
        const imageName = claims.P18[0].mainsnak.datavalue.value;
        return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName.replace(/ /g, '_'))}?width=500`;
      }
    }

    // 2. Try Wikipedia PageImages (ZH then EN)
    const getWikiImage = async (lang: string) => {
      const wikiUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&format=json&pithumbsize=500`;
      const wikiRes = await fetch(wikiUrl, { headers });
      const wikiData = await wikiRes.json() as any;
      const pages = wikiData.query?.pages;
      if (pages) {
        const pageId = Object.keys(pages)[0];
        if (pageId !== "-1" && pages[pageId].thumbnail) return pages[pageId].thumbnail.source;
      }
      return null;
    };

    let img = await getWikiImage("zh");
    if (!img) img = await getWikiImage("en");
    if (img) return img;

    // 3. Fallback: AI Generated Illustration
    return `https://image.pollinations.ai/prompt/${encodeURIComponent("Historical portrait of " + name + ", realistic oil painting style, highly detailed, historical accuracy")}`;
  } catch (e) {
    console.error("Portrait fetch error:", e);
    return null;
  }
}

function addRelationship(p1: number, p2: number, type: string) {
  const min = Math.min(p1, p2);
  const max = Math.max(p1, p2);
  try {
    db.prepare("INSERT INTO relationships (person1_id, person2_id, relationship_type) VALUES (?, ?, ?)").run(min, max, type);
  } catch(e) {
    // Ignore duplicate relationships
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // ==== Admin API ====
  app.post("/api/admin/verify", express.json(), (req, res) => {
    const { password } = req.body;
    const adminPass = process.env.ADMIN_PASSWORD || "admin";
    if (password === adminPass) {
      res.json({ success: true });
    } else {
      res.status(401).json({ error: "密码错误" });
    }
  });

  app.get("/api/admin/config", (req, res) => {
    const pass = req.headers["x-admin-password"];
    const adminPass = process.env.ADMIN_PASSWORD || "admin";
    if (pass !== adminPass) return res.status(401).json({ error: "Unauthorized" });

    res.json({
      active_model_provider: getConfig("active_model_provider", "gemini"),
      gemini_api_key: getConfig("gemini_api_key"),
      gemini_model_id: getConfig("gemini_model_id"),
      aliyun_api_key: getConfig("aliyun_api_key"),
      aliyun_model_id: getConfig("aliyun_model_id"),
      guest_explore_limit: getConfig("guest_explore_limit", "5"),
    });
  });

  app.post("/api/admin/config", express.json(), (req, res) => {
    const pass = req.headers["x-admin-password"];
    const adminPass = process.env.ADMIN_PASSWORD || "admin";
    if (pass !== adminPass) return res.status(401).json({ error: "Unauthorized" });

    const { active_model_provider, gemini_api_key, gemini_model_id, aliyun_api_key, aliyun_model_id, guest_explore_limit } = req.body;
    if (active_model_provider) setConfig("active_model_provider", active_model_provider);
    if (gemini_api_key !== undefined) setConfig("gemini_api_key", gemini_api_key);
    if (gemini_model_id !== undefined) setConfig("gemini_model_id", gemini_model_id);
    if (aliyun_api_key !== undefined) setConfig("aliyun_api_key", aliyun_api_key);
    if (aliyun_model_id !== undefined) setConfig("aliyun_model_id", aliyun_model_id);
    if (guest_explore_limit !== undefined) setConfig("guest_explore_limit", String(guest_explore_limit));

    res.json({ success: true });
  });

  app.get("/api/admin/people", (req, res) => {
    const pass = req.headers["x-admin-password"];
    const adminPass = process.env.ADMIN_PASSWORD || "admin";
    if (pass !== adminPass) return res.status(401).json({ error: "Unauthorized" });
    const people = db.prepare("SELECT id, name, category, created_at FROM people ORDER BY created_at DESC").all();
    res.json(people);
  });

  app.delete("/api/admin/people/:id", (req, res) => {
    const pass = req.headers["x-admin-password"];
    const adminPass = process.env.ADMIN_PASSWORD || "admin";
    if (pass !== adminPass) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    db.prepare("DELETE FROM relationships WHERE person1_id = ? OR person2_id = ?").run(id, id);
    db.prepare("DELETE FROM people WHERE id = ?").run(id);
    res.json({ success: true });
  });

  app.post("/api/admin/people/batch-delete", (req, res) => {
    const pass = req.headers["x-admin-password"];
    const adminPass = process.env.ADMIN_PASSWORD || "admin";
    if (pass !== adminPass) return res.status(401).json({ error: "Unauthorized" });
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "No ids provided" });
    
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM relationships WHERE person1_id IN (${placeholders}) OR person2_id IN (${placeholders})`).run(...ids, ...ids);
    db.prepare(`DELETE FROM people WHERE id IN (${placeholders})`).run(...ids);
    
    res.json({ success: true });
  });

  // ==== Application API ====

  app.get("/api/archive", (req, res) => {
    const people = db.prepare("SELECT * FROM people ORDER BY created_at DESC").all();
    const relationships = db.prepare("SELECT * FROM relationships").all();
    res.json({ people, relationships });
  });

  app.get("/api/metadata", (req, res) => {
    const existingPeopleNames = (db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name).join("、");
    res.json({
        categories: CATEGORIES,
        existingNames: existingPeopleNames,
        activeProvider: getConfig("active_model_provider", "gemini"),
        geminiModelId: getConfig("gemini_model_id"),
        geminiApiKey: getConfig("gemini_api_key") || process.env.GEMINI_API_KEY,
        aliyunModelId: getConfig("aliyun_model_id"),
        aliyunApiKey: getConfig("aliyun_api_key"),
        remainingQuota: getRemainingQuota()
    });
  });

  app.get("/api/usage/remaining", (req, res) => {
    res.json({ remaining: getRemainingQuota() });
  });

  app.post("/api/usage/record", (req, res) => {
    incrementUsage();
    res.json({ success: true, remaining: getRemainingQuota() });
  });

  app.post("/api/people/:id/view", (req, res) => {
    const { id } = req.params;
    db.prepare("UPDATE people SET views = views + 1 WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // Save AI Archiving Results
  app.post("/api/save-archive", async (req, res) => {
    const { name, data } = req.body;
    if (!name) return res.status(400).json({ error: "Missing name" });

    const existing = db.prepare("SELECT id, biography FROM people WHERE name = ?").get(name) as any;
    const isFull = existing && existing.biography !== "正在同步资料...";

    // If we only have the name and no data, and it doesn't exist, we don't create a stub anymore
    if (!data) {
      if (existing) return res.json({ id: existing.id, isNew: false, isFull });
      return res.json({ id: null, isNew: true, isFull: false });
    }

    // If full data is provided, save or update the person
    try {
      const portraitUrl = await getPortraitUrl(name);
      const stmt = db.prepare(`
        INSERT INTO people (name, category, keyword, lifespan, birthplace, biography, achievements, image_url, raw_relationships, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET 
          category=excluded.category, 
          keyword=excluded.keyword, 
          lifespan=excluded.lifespan, 
          birthplace=excluded.birthplace, 
          biography=excluded.biography, 
          achievements=excluded.achievements, 
          image_url=excluded.image_url, 
          raw_relationships=excluded.raw_relationships, 
          latitude=excluded.latitude, 
          longitude=excluded.longitude
        RETURNING id
      `);
      
      const inserted = stmt.get(
          name,
          data.category || "其他",
          data.keyword || "",
          data.lifespan || "",
          data.birthplace || "",
          data.biography || "",
          JSON.stringify(data.achievements || []),
          portraitUrl,
          JSON.stringify(data.relationships || []),
          data.latitude || 0,
          data.longitude || 0
      ) as { id: number };

      // Process relationships
      if (data.relationships && Array.isArray(data.relationships)) {
          for (const rel of data.relationships) {
              const matched = db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
              if (matched) {
                  addRelationship(inserted.id, matched.id, rel.relationshipType);
              }
          }
      }
      res.json({ id: inserted.id, isNew: true, isFull: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message });
    }
  });

  // Six Degrees Pathfinding (Hybrid: Local DB BFS first)
  app.post("/api/pathfind", async (req, res) => {
    let { sourceName, targetName } = req.body;
    if (!sourceName || !targetName) return res.status(400).json({ error: "Missing names" });

    const people = db.prepare("SELECT id, name, raw_relationships FROM people").all() as any[];
    const relationships = db.prepare("SELECT * FROM relationships").all() as any[];

    const nameToId = new Map(people.map(p => [p.name, p.id]));
    const idToName = new Map(people.map(p => [p.id, p.name]));

    const adj = new Map<number, { id: number, type: string }[]>();
    relationships.forEach(r => {
      if (!adj.has(r.person1_id)) adj.set(r.person1_id, []);
      if (!adj.has(r.person2_id)) adj.set(r.person2_id, []);
      adj.get(r.person1_id)!.push({ id: r.person2_id, type: r.relationship_type });
      adj.get(r.person2_id)!.push({ id: r.person1_id, type: r.relationship_type });
    });

    // Add implied relationships from raw_relationships if both parties are in DB
    people.forEach(p => {
      try {
        const raw = JSON.parse(p.raw_relationships || "[]");
        raw.forEach((r: any) => {
          if (!r.personName) return;
          const targetId = nameToId.get(r.personName);
          if (targetId !== undefined && targetId !== p.id) {
            // Add p -> target
            if (!adj.has(p.id)) adj.set(p.id, []);
            if (!adj.get(p.id)!.some(n => n.id === targetId)) {
              adj.get(p.id)!.push({ id: targetId, type: r.relationshipType || "历史关联" });
            }
            // Add target -> p
            if (!adj.has(targetId)) adj.set(targetId, []);
            if (!adj.get(targetId)!.some(n => n.id === p.id)) {
              adj.get(targetId)!.push({ id: p.id, type: r.relationshipType || "历史关联" });
            }
          }
        });
      } catch (e) {}
    });

    const startId = nameToId.get(sourceName);
    const endId = nameToId.get(targetName);

    if (startId !== undefined && endId !== undefined) {
      const queue: { id: number, path: { name: string, type?: string }[] }[] = [{ id: startId, path: [{ name: sourceName }] }];
      const visited = new Set([startId]);

      while (queue.length > 0) {
        const { id, path } = queue.shift()!;
        if (id === endId) return res.json({ path });

        const neighbors = adj.get(id) || [];
        for (const n of neighbors) {
          if (!visited.has(n.id)) {
            visited.add(n.id);
            queue.push({ id: n.id, path: [...path, { name: idToName.get(n.id)!, type: n.type }] });
          }
        }
      }
    }

    res.json({ path: null }); // Signal frontend to use AI
  });

  // Pick two random existing people for home page discovery
  app.get("/api/archiver/random-pair", (req, res) => {
    const count = db.prepare("SELECT COUNT(*) as count FROM people").get() as { count: number };
    if (count.count < 2) {
      return res.status(400).json({ error: "Need at least 2 people in database" });
    }
    
    const people = db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 2").all() as any[];
    res.json({ sourceName: people[0].name, targetName: people[1].name });
  });

  // Helper for background archiving (Random Selection)
  app.post("/api/archiver/pick-target", (req, res) => {
    const existing = (db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name);
    if (existing.length === 0) return res.json({ error: "No people in database to start from" });
    const existingSet = new Set(existing);

    // Pick a random source
    const sourceName = existing[Math.floor(Math.random() * existing.length)];

    let targetName = "";

    // 1. Try to pick from FIGURE_POOL
    const unarchivedInPool: string[] = [];
    for (const cat of CATEGORIES) {
        FIGURE_POOL[cat]?.forEach(n => { if (!existingSet.has(n)) unarchivedInPool.push(n); });
    }

    if (unarchivedInPool.length > 0) {
        targetName = unarchivedInPool[Math.floor(Math.random() * unarchivedInPool.length)];
    } else {
        // 2. Try to find people mentioned in relationships who aren't archived yet
        const wanted = new Set<string>();
        const peopleRels = db.prepare("SELECT raw_relationships FROM people").all() as any[];
        peopleRels.forEach(p => {
            try {
                const rels = JSON.parse(p.raw_relationships || "[]");
                rels.forEach((r: any) => { if (r.personName && !existingSet.has(r.personName)) wanted.add(r.personName); });
            } catch(e) {}
        });

        if (wanted.size > 0) {
            const wantedArray = Array.from(wanted);
            targetName = wantedArray[Math.floor(Math.random() * wantedArray.length)];
        }
    }

    res.json({ sourceName, targetName });
  });

  // Pick a random target using AI if needed (Famous positive figures)
  app.post("/api/archiver/generate-target", async (req, res) => {
    const { sourceName } = req.body;
    const existingNames = (db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name).join("、");
    
    try {
        const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。
要求：
1. 该人物不在以下列表中：[${existingNames.slice(0, 1000)}]
2. 如果可能，请选取一个与 "${sourceName || '苏格拉底'}" 有潜在跨时空关联或对比价值的人物（哪怕是通过多次跳转）。
3. 只返回该人物的标准中文译名，不要任何解释。
4. 确保该人物具有极高的公众认知度。`;
        
        const resultText = await callAI(prompt, "text");
        const targetName = (resultText || "").trim().replace(/[「」""'']/g, "");
        res.json({ targetName });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
  });

  // Manual / Auto Archive Figure with Streaming
  app.post("/api/archive-figure", async (req, res) => {
    const { personName, stream } = req.body;
    let targetName = personName;

    const existingNames = (db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name).join("、");

    if (!targetName) {
        // Pick a target logic
        const existing = (db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name);
        const existingSet = new Set(existing);

        // 1. Try to pick from FIGURE_POOL (Highest Priority per user request)
        const unarchivedInPool: {name: string, cat: string}[] = [];
        for (const cat of CATEGORIES) {
            FIGURE_POOL[cat]?.forEach(n => { if (!existingSet.has(n)) unarchivedInPool.push({name: n, cat}); });
        }

        if (unarchivedInPool.length > 0) {
            targetName = unarchivedInPool[Math.floor(Math.random() * unarchivedInPool.length)].name;
        } else {
            // 2. Try to find people mentioned in relationships who aren't archived yet
            const wanted = new Set<string>();
            const peopleRels = db.prepare("SELECT raw_relationships FROM people").all() as any[];
            peopleRels.forEach(p => {
                try {
                    const rels = JSON.parse(p.raw_relationships || "[]");
                    rels.forEach((r: any) => { if (r.personName && !existingSet.has(r.personName)) wanted.add(r.personName); });
                } catch(e) {}
            });

            if (wanted.size > 0) {
                const wantedArray = Array.from(wanted);
                targetName = wantedArray[Math.floor(Math.random() * wantedArray.length)];
            } else {
                // 3. Pool & Relationships exhausted, pick a random person from DB and ask AI for someone related
                try {
                    const randomPerson = existing[Math.floor(Math.random() * existing.length)] || "苏格拉底";
                    const prompt = `已知 "${randomPerson}" 现已在库。
请从世界历史中选取一位极其著名、且与 "${randomPerson}" 有【重大历史关联】的真实历史人物。
要求：
1. 该人物不在以下列表中：[${existingNames.slice(0, 1000)}]
2. 请直接返回该人物的标准中文译名，不要任何额外解释。`;
                    const resultText = await callAI(prompt, "text");
                    targetName = (resultText || "").trim().replace(/[「」""'']/g, "");
                } catch (e) {
                    return res.status(500).json({ error: "无法选取新人物" });
                }
            }
        }
    }

    if (stream) {
        const pass = req.headers["x-admin-password"];
        const adminPass = process.env.ADMIN_PASSWORD || "admin";
        const isAdmin = pass === adminPass;

        if (!isAdmin && getRemainingQuota() <= 0) {
            return res.status(403).json({ error: "今日探索次数已达上限，请明天再试或联系管理员。" });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

        try {
            send({ type: 'info', msg: `确定抓取目标: ${targetName}` });
            
            send({ type: 'info', msg: `正在利用 AI 深度检索并编织 ${targetName} 的历史时空数据...` });
            
            const prompt = `你是一位研究历史人物的传记专家。请为 "${targetName}" 撰写传记。
要求返回 JSON:
{
  "keyword": "格言",
  "lifespan": "出生日期-去世日期",
  "birthplace": "出生地点",
  "biography": "分段呈现，语言正规且诙谐幽默，直接进入主题，不要有‘观众朋友们好’之类的开场白。",
  "achievements": ["成就1", "成就2"],
  "category": "从[${CATEGORIES.join(",")}]选一",
  "latitude": 纬度,
  "longitude": 经度,
  "relationships": [{"personName": "关联人名", "relationshipType": "请用20-30字描述关联"}]
}
重要：必须至少包含 1 个以下已入库人物：[${existingNames.slice(0, 500)}]。`;

            let resultText = await callAI(prompt, "json");
            const jsonMatch = resultText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
               resultText = jsonMatch[0];
            }
            const data = JSON.parse(resultText || "{}");

            send({ type: 'info', msg: `正在获取 ${targetName} 的历史肖像...` });
            const portraitUrl = await getPortraitUrl(targetName);

            send({ type: 'info', msg: `正在将 ${targetName} 录入时空档案馆...` });
            
            // Re-check for existence just in case parallel requests added it
            const existing = db.prepare("SELECT id FROM people WHERE name = ?").get(targetName) as any;
            let personId: number;
            
            if (existing) {
                personId = existing.id;
                send({ type: 'info', msg: `${targetName} 已存在，正在更新资料...` });
            } else {
                const stmt = db.prepare(`
                    INSERT INTO people (name, category, keyword, lifespan, birthplace, biography, achievements, image_url, raw_relationships, latitude, longitude)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
                `);
                const inserted = stmt.get(
                    targetName,
                    data.category || "其他",
                    data.keyword || "",
                    data.lifespan || "",
                    data.birthplace || "",
                    data.biography || "",
                    JSON.stringify(data.achievements || []),
                    portraitUrl,
                    JSON.stringify(data.relationships || []),
                    data.latitude || 0,
                    data.longitude || 0
                ) as { id: number };
                personId = inserted.id;
            }

            // Process relationships
            if (data.relationships && Array.isArray(data.relationships)) {
                let connCount = 0;
                for (const rel of data.relationships) {
                    const matched = db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
                    if (matched) {
                        addRelationship(personId, matched.id, rel.relationshipType);
                        connCount++;
                    }
                }
                if (connCount > 0) {
                    send({ type: 'info', msg: `成功建立 ${connCount} 条时空连接。` });
                } else {
                    send({ type: 'info', msg: `未发现即时时空连接，已保留关联索引供后续追溯。` });
                }
            }

            if (!isAdmin) {
                incrementUsage();
                send({ type: 'usage-update', remaining: getRemainingQuota() });
            }

            send({ type: 'result', personId });
            res.end();
        } catch (e: any) {
            send({ type: 'error', msg: e.message });
            res.end();
        }
    } else {
        // Non-streaming implementation (simplified)
        res.status(400).json({ error: "Always use streaming for this endpoint in current UI" });
    }
  });

  app.post("/api/save-relationship", (req, res) => {
    const { sourceName, targetName, relationshipType } = req.body;
    if (!sourceName || !targetName || !relationshipType) return res.status(400).json({ error: "Missing info" });

    const p1 = db.prepare("SELECT id FROM people WHERE name = ?").get(sourceName) as any;
    const p2 = db.prepare("SELECT id FROM people WHERE name = ?").get(targetName) as any;

    if (p1 && p2) {
      addRelationship(p1.id, p2.id, relationshipType);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "People not found for relationship" });
    }
  });

  app.post("/api/ai/proxy", async (req, res) => {
    const { prompt, responseFormat, schema } = req.body;
    try {
        const text = await callAI(prompt, responseFormat, schema);
        res.json({ text });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
