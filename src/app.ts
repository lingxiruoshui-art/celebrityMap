import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GoogleGenAI } from "@google/genai";
import { D1DatabaseAdapter, DatabaseAdapter } from "./db.ts";
import { CATEGORIES, FIGURE_POOL } from "./figuresPool.ts";
import { ARCHIVE_PROMPT, ARCHIVE_SCHEMA, PATH_PROMPT, PATH_SCHEMA, VALIDATION_PROMPT, VALIDATION_SCHEMA } from "./services/geminiService.ts";
import { runExplorationTask } from "./exploreTask.ts";

const root = new Hono<{ 
  Bindings: { 
    DB?: any;
    IMAGES?: any;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL_ID?: string;
    ADMIN_PASSWORD?: string;
    EXPLORE_KV?: any;
  },
  Variables: { dbAdapter: DatabaseAdapter } 
}>();

export const app = root.basePath('/api');

app.onError((err, c) => {
  console.error("Hono error:", err);
  return c.json({ error: err.message || "Internal Server Error", stack: process.env.NODE_ENV === 'development' ? err.stack : undefined }, 500);
});

app.notFound((c) => {
  console.warn(`Hono 404: ${c.req.method} ${c.req.url}`);
  return c.json({ error: "Not Found", path: c.req.path, method: c.req.method }, 404);
});

// Global for Node fallback
let nodeDbInstance: DatabaseAdapter | null = null;
let dbInitialized = false;

async function getDb(c: any): Promise<DatabaseAdapter> {
  let db: DatabaseAdapter;
  if (c.env && c.env.DB_ADAPTER) {
    db = c.env.DB_ADAPTER;
  } else if (c.env && c.env.DB) {
    db = new D1DatabaseAdapter(c.env.DB);
  } else {
    throw new Error(`No database adapter provided. Ensure D1 is bound as 'DB'. Environment keys available: ${c.env ? Object.keys(c.env).join(', ') : 'none'}`);
  }
  
  if (!dbInitialized) {
    const initQueries = [
      `CREATE TABLE IF NOT EXISTS people (
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
      )`,
      `CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person1_id INTEGER NOT NULL,
        person2_id INTEGER NOT NULL,
        relationship_type TEXT NOT NULL,
        FOREIGN KEY(person1_id) REFERENCES people(id),
        FOREIGN KEY(person2_id) REFERENCES people(id),
        UNIQUE(person1_id, person2_id)
      )`,
      `CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      )`
    ];
    for (const q of initQueries) {
      await db.prepare(q).run();
    }
    
    const migrations = [
      "ALTER TABLE people ADD COLUMN latitude REAL DEFAULT 0",
      "ALTER TABLE people ADD COLUMN longitude REAL DEFAULT 0",
      "ALTER TABLE people ADD COLUMN image_url TEXT",
      "ALTER TABLE people ADD COLUMN lifespan TEXT",
      "ALTER TABLE people ADD COLUMN birthplace TEXT",
      "CREATE INDEX IF NOT EXISTS idx_relationships_person2 ON relationships(person2_id)"
    ];
    for (const m of migrations) {
      try { await db.prepare(m).run(); } catch (e) {}
    }
    dbInitialized = true;
  }
  return db;
}

export const getConfig = async (db: DatabaseAdapter, key: string, defaultValue: string = "") => {
  const row = await db.prepare("SELECT value FROM config WHERE key = ?").get(key) as any;
  if (!row || row.value === null || row.value === undefined) return defaultValue;
  return String(row.value);
};

export const setConfig = async (db: DatabaseAdapter, key: string, value: string) => {
  await db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};

const getAdminPassword = (c: any) => {
    return (c.env && c.env.ADMIN_PASSWORD) || (typeof process !== "undefined" && process.env.ADMIN_PASSWORD) || "admin";
};

export async function callAI(c: any, db: DatabaseAdapter, prompt: string, responseFormat: "text" | "json" = "text", schema?: any): Promise<string> {
  const provider = await getConfig(db, "active_model_provider", "gemini");
  
  if (provider === "aliyun") {
    const apiKey = await getConfig(db, "aliyun_api_key");
    const modelId = await getConfig(db, "aliyun_model_id");
    if (!apiKey) throw new Error("缺少 Aliyun API Key");
    if (!modelId) throw new Error("缺少 Aliyun 模型 ID");
    
    const systemContent = `你是一个历史学和百科知识专家。当被要求返回 JSON 时，请严格遵守指定的 schema，且只返回 JSON 原始内容。不要包含任何 Markdown 格式。`;

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

    try {
      const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: "system", content: systemContent },
            { role: "user", content: prompt }
          ],
          ...(responseFormat === "json" ? { response_format: { type: "json_object" } } : {})
        })
      });
      
      clearTimeout(timeoutId);
      
      if (!res.ok) {
        console.error(`Aliyun API error: ${res.status} ${res.statusText}`);
        throw new Error(`Aliyun API error`);
      }
      const json = await res.json() as any;
      const duration = Date.now() - startTime;
      console.log(`Aliyun call took ${duration}ms`);
      let content = json.choices[0].message.content || "";
      content = content.replace(/<think>[\s\S]*?<\/think>/ig, '').trim();
      if (responseFormat === "json") {
         const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/i);
         if (jsonMatch) content = jsonMatch[1].trim();
         else {
           const firstBrace = content.indexOf('{');
           const firstBracket = content.indexOf('[');
           let start = -1, end = -1;
           if (firstBrace !== -1 && firstBracket !== -1) {
               start = Math.min(firstBrace, firstBracket);
               end = start === firstBrace ? content.lastIndexOf('}') : content.lastIndexOf(']');
           } else if (firstBrace !== -1) {
               start = firstBrace; end = content.lastIndexOf('}');
           } else if (firstBracket !== -1) {
               start = firstBracket; end = content.lastIndexOf(']');
           }
           if (start !== -1 && end !== -1) content = content.substring(start, end + 1);
         }
      }
      return content;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') throw new Error("AI 调用超时 (120s)");
      throw err;
    }
  } else {
    const apiKey = (await getConfig(db, "gemini_api_key")) || (c.env && c.env.GEMINI_API_KEY) || (typeof process !== "undefined" && process.env.GEMINI_API_KEY);
    const modelId = (await getConfig(db, "gemini_model_id")) || (c.env && c.env.GEMINI_MODEL_ID) || (typeof process !== "undefined" && process.env.GEMINI_MODEL_ID) || "gemini-1.5-flash";
    if (!apiKey) throw new Error("缺少 Gemini API Key");
    if (!modelId) throw new Error("缺少 Gemini 模型 ID");
    
    const ai = new GoogleGenAI({ apiKey });
    const startTime = Date.now();
    try {
      const generatePromise = ai.models.generateContent({
        model: modelId,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: responseFormat === "json" ? { 
          responseMimeType: "application/json",
          responseSchema: schema 
        } : undefined
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Timeout")), 120000);
      });

      const result = await Promise.race([generatePromise, timeoutPromise]) as any;

      const duration = Date.now() - startTime;
      console.log(`Gemini call took ${duration}ms`);
      let content = result.response?.text() || result.text || "";
      content = content.replace(/<think>[\s\S]*?<\/think>/ig, '').trim();
      if (responseFormat === "json") {
         const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/i);
         if (jsonMatch) content = jsonMatch[1].trim();
         else {
           const firstBrace = content.indexOf('{');
           const firstBracket = content.indexOf('[');
           let start = -1, end = -1;
           if (firstBrace !== -1 && firstBracket !== -1) {
               start = Math.min(firstBrace, firstBracket);
               end = start === firstBrace ? content.lastIndexOf('}') : content.lastIndexOf(']');
           } else if (firstBrace !== -1) {
               start = firstBrace; end = content.lastIndexOf('}');
           } else if (firstBracket !== -1) {
               start = firstBracket; end = content.lastIndexOf(']');
           }
           if (start !== -1 && end !== -1) content = content.substring(start, end + 1);
         }
      }
      return content;
    } catch (err: any) {
      const duration = Date.now() - startTime;
      console.error(`Gemini call failed after ${duration}ms:`, err);
      if (err.message === "Timeout") throw new Error("AI 调用超时 (120s)");
      throw err;
    }
  }
}

async function getPortraitUrl(c: any, name: string): Promise<string | null> {
  const imagesBucket = c.env?.IMAGES;
  const localPath = `/api/portraits/${encodeURIComponent(name.toLowerCase())}.jpg`;
  return localPath;
}

export async function addRelationship(db: DatabaseAdapter, p1: number, p2: number, type: string) {
  const min = Math.min(p1, p2);
  const max = Math.max(p1, p2);
  try {
    await db.prepare(`
      INSERT INTO relationships (person1_id, person2_id, relationship_type) 
      VALUES (?, ?, ?) 
      ON CONFLICT(person1_id, person2_id) DO UPDATE SET 
        relationship_type = CASE 
          WHEN length(excluded.relationship_type) > length(relationship_type) THEN excluded.relationship_type 
          ELSE relationship_type 
        END
    `).run(min, max, type);
  } catch(e) {}
}

app.get("/health", (c) => c.json({ status: "ok" }));

async function fetchAndStoreImage(c: any, filename: string) {
  const imagesBucket = c.env?.IMAGES;
  if (!imagesBucket) return null;

  const name = decodeURIComponent(filename.replace(/\\.jpg$/i, ''));
  const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
  
  try {
    let finalUrl = "";
    
    const searchWikidata = async (lang: string) => {
      const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&format=json`, { headers });
      const data = await res.json() as any;
      return data.search?.[0];
    };

    let entity = await searchWikidata("zh");
    if (!entity) entity = await searchWikidata("en");
    if (entity) {
      const entityRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims&format=json`, { headers });
      const entityData = await entityRes.json() as any;
      const claims = entityData.entities[entity.id].claims;
      if (claims.P18 && claims.P18.length > 0) {
        const imageName = claims.P18[0].mainsnak.datavalue.value;
        finalUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName.replace(/ /g, '_'))}?width=500`;
      }
    }

    if (!finalUrl) {
      const getWikiImage = async (lang: string) => {
        const wikiRes = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}&prop=pageimages&format=json&pithumbsize=500`, { headers });
        const wikiData = await wikiRes.json() as any;
        const pages = wikiData.query?.pages;
        if (pages) {
          const pageId = Object.keys(pages)[0];
          if (pageId !== "-1" && pages[pageId].thumbnail) return pages[pageId].thumbnail.source;
        }
        return null;
      };
      finalUrl = await getWikiImage("zh") || await getWikiImage("en") || "";
    }

    if (!finalUrl) {
      finalUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent("Historical portrait of " + name + ", realistic oil painting style, highly detailed, historical accuracy")}`;
    }

    if (finalUrl) {
      const imageRes = await fetch(finalUrl, { headers });
      if (imageRes.ok) {
        const contentType = imageRes.headers.get("content-type") || "image/jpeg";
        const buffer = await imageRes.arrayBuffer();
        const key = `portraits/${filename}`;
        await imagesBucket.put(key, buffer, { httpMetadata: { contentType: contentType } });
        return { body: buffer, contentType };
      }
    }
  } catch (e) {
    console.error("Lazy transfer error for", name, e);
  }
  return null;
}

app.get("/portraits/:filename", async (c) => {
  const imagesBucket = c.env?.IMAGES;
  const filename = c.req.param("filename");
  
  if (!imagesBucket) {
      return c.json({ error: "R2 Image Storage not configured" }, 404);
  }
  
  let object = await imagesBucket.get(`portraits/${filename}`);
  
  if (!object) {
    const result = await fetchAndStoreImage(c, filename);
    if (result) {
      const headers = new Headers();
      headers.set("Content-Type", result.contentType);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(result.body as any, { headers });
    }
    return c.json({ error: "Image not found" }, 404);
  }
  
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  
  return new Response(object.body as any, { headers });
});

app.post("/admin/verify", async (c) => {
  const { password } = await c.req.json();
  if (password === getAdminPassword(c)) return c.json({ success: true });
  return c.json({ error: "密码错误" }, 401);
});

app.get("/admin/config", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  return c.json({
    active_model_provider: await getConfig(db, "active_model_provider", "gemini"),
    gemini_api_key: await getConfig(db, "gemini_api_key"),
    gemini_model_id: await getConfig(db, "gemini_model_id"),
    aliyun_api_key: await getConfig(db, "aliyun_api_key"),
    aliyun_model_id: await getConfig(db, "aliyun_model_id"),
  });
});

app.post("/admin/config", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const body = await c.req.json();
  if (body.active_model_provider) await setConfig(db, "active_model_provider", body.active_model_provider);
  if (body.gemini_api_key !== undefined) await setConfig(db, "gemini_api_key", body.gemini_api_key);
  if (body.gemini_model_id !== undefined) await setConfig(db, "gemini_model_id", body.gemini_model_id);
  if (body.aliyun_api_key !== undefined) await setConfig(db, "aliyun_api_key", body.aliyun_api_key);
  if (body.aliyun_model_id !== undefined) await setConfig(db, "aliyun_model_id", body.aliyun_model_id);
  return c.json({ success: true });
});

app.get("/admin/people", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const people = await db.prepare("SELECT id, name, category, created_at FROM people ORDER BY created_at DESC").all();
  return c.json(people);
});

app.delete("/admin/people/:id", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const id = c.req.param("id");
  await db.prepare("DELETE FROM relationships WHERE person1_id = ? OR person2_id = ?").run(id, id);
  await db.prepare("DELETE FROM people WHERE id = ?").run(id);
  return c.json({ success: true });
});

app.post("/admin/people/batch-delete", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "No ids provided" }, 400);
  const placeholders = ids.map(() => "?").join(",");
  await db.prepare(`DELETE FROM relationships WHERE person1_id IN (${placeholders}) OR person2_id IN (${placeholders})`).run(...ids, ...ids);
  await db.prepare(`DELETE FROM people WHERE id IN (${placeholders})`).run(...ids);
  return c.json({ success: true });
});

app.post("/admin/repair-images", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  try {
      const people = await db.prepare("SELECT id, name FROM people").all() as any[];
      for (const p of people) {
          const newUrl = `/api/portraits/${encodeURIComponent(p.name.toLowerCase())}.jpg`;
          await db.prepare("UPDATE people SET image_url = ? WHERE id = ?").run(newUrl, p.id);
      }
      return c.json({ success: true, message: "所有人物图片已切换至本地代理模式（按需异步加载）" });
  } catch (e: any) {
      return c.json({ error: e.message }, 500);
  }
});

app.get("/archive", async (c) => {
  const db = await getDb(c);
  let people = await db.prepare("SELECT * FROM people ORDER BY created_at DESC").all() as any[];
  const relationships = await db.prepare("SELECT * FROM relationships").all();
  
  people = people.map(p => ({
    ...p,
    image_url: `/api/portraits/${encodeURIComponent(p.name.toLowerCase())}.jpg`
  }));

  return c.json({ people, relationships });
});

app.get("/metadata", async (c) => {
  const db = await getDb(c);
  const existingPeopleNames = (await db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name).join("、");
  return c.json({
      categories: CATEGORIES,
      existingNames: existingPeopleNames,
      activeProvider: await getConfig(db, "active_model_provider", "gemini"),
      geminiModelId: await getConfig(db, "gemini_model_id"),
      geminiApiKey: !!((await getConfig(db, "gemini_api_key")) || (c.env && c.env.GEMINI_API_KEY) || (typeof process !== "undefined" && process.env.GEMINI_API_KEY)),
      aliyunModelId: await getConfig(db, "aliyun_model_id"),
      aliyunApiKey: !!(await getConfig(db, "aliyun_api_key")),
  });
});

app.post("/people/:id/view", async (c) => {
  const db = await getDb(c);
  const id = c.req.param("id");
  await db.prepare("UPDATE people SET views = views + 1 WHERE id = ?").run(id);
  return c.json({ success: true });
});

app.post("/save-archive", async (c) => {
  const db = await getDb(c);
  const { name, data } = await c.req.json();
  if (!name) return c.json({ error: "Missing name" }, 400);

  const existing = await db.prepare("SELECT id, biography FROM people WHERE name = ?").get(name) as any;
  const isFull = existing && existing.biography !== "正在同步资料...";

  if (!data) {
    if (existing) return c.json({ id: existing.id, isNew: false, isFull });
    return c.json({ id: null, isNew: true, isFull: false });
  }

  try {
    const portraitUrl = await getPortraitUrl(c, name);
    const stmt = db.prepare(`
      INSERT INTO people (name, category, keyword, lifespan, birthplace, biography, achievements, image_url, raw_relationships, latitude, longitude)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET 
        category=excluded.category, keyword=excluded.keyword, lifespan=excluded.lifespan, birthplace=excluded.birthplace, biography=excluded.biography, 
        achievements=excluded.achievements, image_url=excluded.image_url, raw_relationships=excluded.raw_relationships, latitude=excluded.latitude, longitude=excluded.longitude
      RETURNING id
    `);
    
    const inserted = await stmt.get(
        name, data.category || "其他", data.keyword || "", data.lifespan || "", data.birthplace || "", data.biography || "",
        JSON.stringify(data.achievements || []), portraitUrl, JSON.stringify(data.relationships || []), data.latitude || 0, data.longitude || 0
    ) as { id: number };

    if (data.relationships && Array.isArray(data.relationships)) {
        for (const rel of data.relationships) {
            const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
            if (matched) await addRelationship(db, inserted.id, matched.id, rel.relationshipType);
        }
    }
    return c.json({ id: inserted.id, isNew: true, isFull: true });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

app.post("/pathfind", async (c) => {
  const db = await getDb(c);
  let { sourceName, targetName } = await c.req.json();
  if (!sourceName || !targetName) return c.json({ error: "Missing names" }, 400);

  // Optimize: only load needed columns and use efficient lookups
  const people = await db.prepare("SELECT id, name FROM people").all() as any[];
  const nameToId = new Map(people.map(p => [p.name, p.id]));
  const idToName = new Map(people.map(p => [p.id, p.name]));

  const startId = nameToId.get(sourceName);
  const endId = nameToId.get(targetName);

  if (startId === undefined || endId === undefined) return c.json({ path: null });

  const relationships = await db.prepare("SELECT person1_id, person2_id, relationship_type FROM relationships").all() as any[];
  const adj = new Map<number, { id: number, type: string }[]>();
  
  relationships.forEach(r => {
    if (!adj.has(r.person1_id)) adj.set(r.person1_id, []);
    if (!adj.has(r.person2_id)) adj.set(r.person2_id, []);
    adj.get(r.person1_id)!.push({ id: r.person2_id, type: r.relationship_type });
    adj.get(r.person2_id)!.push({ id: r.person1_id, type: r.relationship_type });
  });

  const queue: { id: number, path: { name: string, type?: string }[] }[] = [{ id: startId, path: [{ name: sourceName }] }];
  const visited = new Set([startId]);
  let head = 0;

  while (head < queue.length) {
    const { id, path } = queue[head++];
    if (id === endId) return c.json({ path });

    const neighbors = adj.get(id) || [];
    for (const n of neighbors) {
      if (!visited.has(n.id)) {
        visited.add(n.id);
        queue.push({ id: n.id, path: [...path, { name: idToName.get(n.id)!, type: n.type }] });
      }
    }
    if (queue.length > 2000) break; // Safety break
  }

  return c.json({ path: null });
});

app.post("/archiver/chat", async (c) => {
  const db = await getDb(c);
  try {
    const { person1, person2 } = await c.req.json();
    
    if (!person1 || !person2) {
      return c.json({ error: "Missing person1 or person2" }, 400);
    }

    const prompt = `请发挥你的想象力，设计一段2个回合共4句话的极简对话。对话双方是历史/现实人物：【${person1}】和【${person2}】。
要求：每一句长度控制在1~20个字（极简精炼），确保表达出人物神韵。
人物应保留其经典气质与语言特征，形象鲜明可辨。对白风格有趣且带有跨时空碰撞感，可以是幽默、哲思、讽刺或感人。

请严格返回以下JSON格式：
{
  "messages": [
    { "speaker": "${person1}", "text": "第1句..." },
    { "speaker": "${person2}", "text": "第2句..." },
    { "speaker": "${person1}", "text": "第3句..." },
    { "speaker": "${person2}", "text": "第4句..." }
  ]
}`;

    const schema = {
      type: "object",
      properties: {
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              speaker: { type: "string" },
              text: { type: "string" }
            },
            required: ["speaker", "text"]
          }
        }
      },
      required: ["messages"]
    };

    const responseText = await callAI(c, db, prompt, "json", schema);
    const parsed = JSON.parse(responseText);
    
    return c.json({ messages: parsed.messages || [] });
  } catch (error: any) {
    console.error("Chat generation failed:", error);
    return c.json({ error: "对话生成失败", details: error.message || String(error) }, 500);
  }
});

app.get("/archiver/random-pair", async (c) => {
  const db = await getDb(c);
  const count = await db.prepare("SELECT COUNT(*) as count FROM people").get() as { count: number };
  if (count.count < 2) return c.json({ error: "Need at least 2 people in database" }, 400);
  const people = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 2").all() as any[];
  return c.json({ sourceName: people[0].name, targetName: people[1].name });
});

app.post("/archiver/admin-pick-pair", async (c) => {
  const db = await getDb(c);
  
  const people = await db.prepare("SELECT name, raw_relationships FROM people").all() as any[];
  const archivedNames = people.map(p => p.name);
  const archivedSet = new Set(archivedNames);
  
  const shuffle = (array: any[]) => array.sort(() => 0.5 - Math.random());
  
  // 1. Get available from pool
  const poolUnarchived: string[] = [];
  for (const cat of CATEGORIES) {
      FIGURE_POOL[cat]?.forEach((n: string) => { 
          if (!archivedSet.has(n)) poolUnarchived.push(n); 
      });
  }
  const uniquePoolUnarchived = Array.from(new Set(poolUnarchived));

  // Priority 1: 2 from pool
  if (uniquePoolUnarchived.length >= 2) {
      const picked = shuffle([...uniquePoolUnarchived]).slice(0, 2);
      return c.json({ sourceName: picked[0], targetName: picked[1], strategy: "pool" });
  }

  // 2. Get available from relationships
  const connectedUnarchived = new Set<string>();
  people.forEach(p => {
    try {
      JSON.parse(p.raw_relationships || "[]").forEach((r: any) => {
        if (r.personName && !archivedSet.has(r.personName)) {
           connectedUnarchived.add(r.personName);
        }
      });
    } catch(e) {}
  });
  const uniqueRelsUnarchived = Array.from(connectedUnarchived);

  // Combine (Pool + Rels)
  const combinedUnarchived = Array.from(new Set([...uniquePoolUnarchived, ...uniqueRelsUnarchived]));
  
  // Priority 2: Use unarchived from pool and rels
  if (combinedUnarchived.length >= 2) {
      const picked = shuffle([...combinedUnarchived]).slice(0, 2);
      return c.json({ sourceName: picked[0], targetName: picked[1], strategy: "combined" });
  } else if (combinedUnarchived.length === 1) {
      // 1 unarchived + 1 archived
      if (archivedNames.length > 0) {
          const archived = shuffle([...archivedNames])[0];
          return c.json({ sourceName: combinedUnarchived[0], targetName: archived, strategy: "one-unarch-one-arch" });
      } else {
          // Only 1 person total (unarchived), but no archived to pair with
          // This shouldn't happen if we have people with relationships, but safety check
          return c.json({ sourceName: combinedUnarchived[0], targetName: "", isEmpty: true });
      }
  }
  
  // Fallback: Empty state
  return c.json({ 
     sourceName: "",
     targetName: "",
     isEmpty: true
  });
});

// Backward compatibility
app.post("/archiver/pick-target", async (c) => {
  const db = await getDb(c);
  const existing = (await db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name);
  if (existing.length === 0) return c.json({ error: "No people in database to start from" });
  const existingSet = new Set(existing);

  const sourceName = existing[Math.floor(Math.random() * existing.length)];
  let targetName = "";

  const unarchivedInPool: string[] = [];
  for (const cat of CATEGORIES) {
      FIGURE_POOL[cat]?.forEach(n => { if (!existingSet.has(n)) unarchivedInPool.push(n); });
  }

  if (unarchivedInPool.length > 0) {
      targetName = unarchivedInPool[Math.floor(Math.random() * unarchivedInPool.length)];
  } else {
      const wanted = new Set<string>();
      const peopleRels = await db.prepare("SELECT raw_relationships FROM people").all() as any[];
      peopleRels.forEach(p => {
          try {
              JSON.parse(p.raw_relationships || "[]").forEach((r: any) => { if (r.personName && !existingSet.has(r.personName)) wanted.add(r.personName); });
          } catch(e) {}
      });

      if (wanted.size > 0) {
          const wantedArray = Array.from(wanted);
          targetName = wantedArray[Math.floor(Math.random() * wantedArray.length)];
      }
  }

  return c.json({ sourceName, targetName });
});

app.post("/archiver/generate-target", async (c) => {
  const db = await getDb(c);
  const { sourceName } = await c.req.json();
  const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 20").all() as any[];
  const sampleNames = samplePeople.map(p => p.name).join("、");
  
  try {
      const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。要求不包含在已知列表中：[${sampleNames} ...]，且与 "${sourceName || ''}" 有潜在的历史交集或对比性。`;
      const resultText = await callAI(c, db, prompt, "text");
      const targetName = (resultText || "").trim().replace(/[「」""'']/g, "");
      return c.json({ targetName });
  } catch (e: any) {
      return c.json({ error: e.message }, 500);
  }
});

app.post("/archive-figure", async (c) => {
  const db = await getDb(c);
  const { personName, stream } = await c.req.json();
  let targetName = personName;

  const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 20").all() as any[];
  const sampleNames = samplePeople.map(p => p.name).join("、");

  if (!targetName) {
      return c.json({ error: "Missing target" }, 400);
  }

  if (stream) {
      const pass = c.req.header("x-admin-password");
      const isAdmin = pass === getAdminPassword(c);

      return streamSSE(c, async (stream) => {
          const send = async (data: any) => await stream.writeSSE({ data: JSON.stringify(data) });
          try {
              await send({ type: 'info', msg: `确定抓取目标: ${targetName}` });
              await send({ type: 'info', msg: `正在利用 AI 深度检索并编织 ${targetName} 的历史时空数据...` });
              
              const prompt = `你是一位研究历史人物的传记专家。请为 "${targetName}" 撰写传记。
              要求返回 JSON:
              {
                "keyword": "格言",
                "lifespan": "出生日期-去世日期",
                "birthplace": "出生地点",
                "biography": "分段呈现，语言正规且诙谐幽默，直接进入主题。",
                "achievements": ["成就1", "成就2"],
                "category": "从[${CATEGORIES.join(",")}]选一",
                "latitude": 纬度,
                "longitude": 经度,
                "relationships": [{"personName": "关联人名", "relationshipType": "请用20-30字描述关联"}]
              }
              重要：请尝试建立与已知时空节点的联系（如：${sampleNames} 等）。请使用标准权威的中文译名。`;

              let resultText = await callAI(c, db, prompt, "json");
              let data: any = {};
              try {
                  let rawData = JSON.parse(resultText || "{}");
                  data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
              } catch (e) {
                  data = { category: "其他", biography: "资料解析失败", achievements: [], relationships: [] };
              }

              await send({ type: 'info', msg: `正在获取 ${targetName} 的历史肖像...` });
              const portraitUrl = await getPortraitUrl(c, targetName);

              await send({ type: 'info', msg: `正在将 ${targetName} 录入时空档案馆...` });
              
              const existing = await db.prepare("SELECT id FROM people WHERE name = ?").get(targetName) as any;
              let personId: number;
              
              if (existing) {
                  await send({ type: 'info', msg: `${targetName} 已存在，正在更新资料...` });
              }
              
              const stmt = db.prepare(`
                  INSERT INTO people (name, category, keyword, lifespan, birthplace, biography, achievements, image_url, raw_relationships, latitude, longitude)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(name) DO UPDATE SET 
                    category=excluded.category, keyword=excluded.keyword, lifespan=excluded.lifespan, birthplace=excluded.birthplace, biography=excluded.biography, 
                    achievements=excluded.achievements, image_url=excluded.image_url, raw_relationships=excluded.raw_relationships, latitude=excluded.latitude, longitude=excluded.longitude
                  RETURNING id
              `);
              const inserted = await stmt.get(
                  targetName, data.category || "其他", data.keyword || "", data.lifespan || "", data.birthplace || "", data.biography || "",
                  JSON.stringify(data.achievements || []), portraitUrl, JSON.stringify(data.relationships || []), data.latitude || 0, data.longitude || 0
              ) as { id: number };
              personId = inserted.id;

              if (data.relationships && Array.isArray(data.relationships)) {
                  let connCount = 0;
                  for (const rel of data.relationships) {
                      const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
                      if (matched) {
                          await addRelationship(db, personId, matched.id, rel.relationshipType);
                          connCount++;
                      }
                  }
                  if (connCount > 0) await send({ type: 'info', msg: `成功建立 ${connCount} 条时空连接。` });
                  else await send({ type: 'info', msg: `未发现即时时空连接，已保留关联索引供后续追溯。` });
              }

              await send({ type: 'result', personId });
          } catch (e: any) {
              await send({ type: 'error', msg: e.message });
          }
      });
  } else {
      return c.json({ error: "Always use streaming for this endpoint in current UI" }, 400);
  }
});

app.post("/save-relationship", async (c) => {
  const db = await getDb(c);
  const { sourceName, targetName, relationshipType } = await c.req.json();
  if (!sourceName || !targetName || !relationshipType) return c.json({ error: "Missing info" }, 400);

  const p1 = await db.prepare("SELECT id FROM people WHERE name = ?").get(sourceName) as any;
  const p2 = await db.prepare("SELECT id FROM people WHERE name = ?").get(targetName) as any;

  if (p1 && p2) {
    await addRelationship(db, p1.id, p2.id, relationshipType);
    return c.json({ success: true });
  } else {
    return c.json({ error: "People not found for relationship" }, 404);
  }
});

app.post("/ai/proxy", async (c) => {
  const db = await getDb(c);
  const { prompt, responseFormat, schema } = await c.req.json();
  try {
      const text = await callAI(c, db, prompt, responseFormat, schema);
      return c.json({ text });
  } catch (e: any) {
      return c.json({ error: e.message }, 500);
  }
});

app.get("/explore/status", async (c) => {
  const db = await getDb(c);
  
  // Set no-cache headers
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  c.header("Surrogate-Control", "no-store");

  let statusStr = "null";
  if (c.env && c.env.EXPLORE_KV) {
      statusStr = await c.env.EXPLORE_KV.get("explore_state") || "null";
  } else {
      statusStr = await getConfig(db, "explore_state", "null");
  }
  if (statusStr === "null") return c.json(null);
  const data = JSON.parse(statusStr);
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
  
  if (data && data.status === 'running') {
      const diff = data.lastHeartbeat ? (Date.now() - data.lastHeartbeat) : Infinity;
      if (diff > 60000) { // 60 seconds
          data.status = 'error';
          data.error = '探索任务可能已意外中断或超时。系统检测到心跳丢失，请尝试重置后重新开始。';
          const newState = JSON.stringify(data);
          if (c.env && c.env.EXPLORE_KV) {
              await c.env.EXPLORE_KV.put("explore_state", newState);
          } else {
              await setConfig(db, "explore_state", newState);
          }
      }
  }

  data.isOwner = isAdmin;

  if (!isAdmin) {
      return c.json(null);
  }

  // if not admin, strip logs and steps except last step or error? No, frontend needs steps for UI. 
  if (!isAdmin) {
      data.logs = []; // do not return logs to frontend users
  }
  return c.json(data);
});

app.post("/public/explore", async (c) => {
  const db = await getDb(c);
  const { source, target } = await c.req.json();
  
  if (!source || !target) return c.json({ error: "请输入起点和终点人物" }, 400);

  const matchPerson = async (name: string) => {
      const exact = await db.prepare("SELECT id, name FROM people WHERE name = ? COLLATE NOCASE").all(name) as any[];
      if (exact.length > 0) return exact;
      const fuzzy = await db.prepare("SELECT id, name FROM people WHERE name LIKE ? LIMIT 10").all(`%${name}%`) as any[];
      return fuzzy;
  };

  const srcMatches = await matchPerson(source);
  const tgtMatches = await matchPerson(target);

  if (srcMatches.length === 0) return c.json({ error: `库中未收录人物：${source}` }, 404);
  if (tgtMatches.length === 0) return c.json({ error: `库中未收录人物：${target}` }, 404);

  const isSrcAmbiguous = srcMatches.length > 1 && srcMatches.every(m => m.name.toLowerCase() !== source.toLowerCase() && m.name !== source);
  const isTgtAmbiguous = tgtMatches.length > 1 && tgtMatches.every(m => m.name.toLowerCase() !== target.toLowerCase() && m.name !== target);

  if (isSrcAmbiguous || isTgtAmbiguous) {
      return c.json({
          needsSelection: true,
          sourceOptions: isSrcAmbiguous ? srcMatches.map(m => m.name) : [],
          targetOptions: isTgtAmbiguous ? tgtMatches.map(m => m.name) : []
      });
  }

  // Exact match or uniquely fuzzy matched
  const startId = srcMatches[0].id;
  const endId = tgtMatches[0].id;
  const sourceNameResolved = srcMatches[0].name;
  const targetNameResolved = tgtMatches[0].name;

  if (startId === endId) return c.json({ error: "起点和终点不能是同一个人" }, 400);

  // BFS search
  let head = 0;
  let q = [{ id: startId, path: [{ id: startId, name: sourceNameResolved }] as any[] }];
  let visited = new Set([startId]);
  let directPath = null;
  let limit = 100000;
  
  const allRels = await db.prepare("SELECT person1_id, person2_id, relationship_type as type FROM relationships").all() as any[];
  const idToNameRows = await db.prepare("SELECT id, name FROM people").all() as any[];
  const idToName = new Map<number, string>();
  for (const r of idToNameRows) idToName.set(r.id, r.name);

  const adj = new Map<number, { targetId: number, type: string }[]>();
  for (const r of allRels) {
    if (!adj.has(r.person1_id)) adj.set(r.person1_id, []);
    if (!adj.has(r.person2_id)) adj.set(r.person2_id, []);
    adj.get(r.person1_id)!.push({ targetId: r.person2_id, type: r.type });
    adj.get(r.person2_id)!.push({ targetId: r.person1_id, type: r.type });
  }

  while (head < q.length && limit-- > 0) {
      const curr = q[head++];
      if (curr.id === endId) {
          directPath = curr.path;
          break;
      }
      const neighbors = adj.get(curr.id) || [];
      for (const n of neighbors) {
          if (!visited.has(n.targetId)) {
              visited.add(n.targetId);
              q.push({
                  id: n.targetId,
                  path: [...curr.path, { id: n.targetId, name: idToName.get(n.targetId)!, type: n.type }]
              });
          }
      }
  }

  if (directPath) {
      return c.json({
          status: 'success',
          path: directPath,
          sourceName: sourceNameResolved,
          targetName: targetNameResolved
      });
  } else {
      return c.json({ error: `在当前图谱中，${sourceNameResolved} 和 ${targetNameResolved} 之间尚未建立历史联系网络。` }, 404);
  }
});

app.post("/explore/start", async (c) => {
  const db = await getDb(c);
  const { source, target, isAdmin } = await c.req.json();
  let currentStr = "null";
  if (c.env && c.env.EXPLORE_KV) {
      currentStr = await c.env.EXPLORE_KV.get("explore_state") || "null";
  } else {
      currentStr = await getConfig(db, "explore_state", "null");
  }
  if (currentStr !== "null") {
      const current = JSON.parse(currentStr);
      const isStale = current.status === 'running' && (!current.lastHeartbeat || (Date.now() - current.lastHeartbeat > 60000)); // 60 seconds
      
      if (current.status === 'running' && !isStale) {
          return c.json({ error: "探索正在进行中，请稍候。若任务已长久挂起，请重置状态后重试。" }, 400);
      }
      
      if (isStale) {
          console.warn("Detected stale exploration task, allowing override.");
      }
  }
  
  // Set initial state synchronously so immediately following reads see it
  const initialState = {
      status: 'running', 
      source, 
      target, 
      logs: [], 
      steps: [], 
      path: null, 
      error: null, 
      newArrivals: [],
      lastHeartbeat: Date.now()
  };
  const stateStr = JSON.stringify(initialState);
  if (c.env && c.env.EXPLORE_KV) {
      await c.env.EXPLORE_KV.put("explore_state", stateStr);
  } else {
      await setConfig(db, "explore_state", stateStr);
  }

  const task = runExplorationTask(
      db, source, target, callAI, getConfig, setConfig, addRelationship, 
      ARCHIVE_PROMPT, ARCHIVE_SCHEMA, PATH_PROMPT, PATH_SCHEMA, VALIDATION_PROMPT, VALIDATION_SCHEMA, 
      c, !!isAdmin,
      async (msg) => {
          // Log pulse for debugging in background task
          if (msg !== 'heartbeat') console.log(`[Explore Pulse] ${msg}`);
      }
  );
  
  // Safe check for waitUntil to prevent "no executioncontext" error on non-Worker platforms
  const hasWaitUntil = (() => {
      try {
          return c.executionCtx && typeof c.executionCtx.waitUntil === 'function';
      } catch (e) {
          return false;
      }
  })();

  if (hasWaitUntil) {
      c.executionCtx.waitUntil(task.catch((err: any) => console.error("Background task error:", err)));
  } else {
      task.catch((err: any) => console.error("Background task error:", err));
  }
  
  return c.json({ success: true, status: 'running' });
});

app.post("/explore/stop", async (c) => {
  const db = await getDb(c);
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);

  let statusStr = "null";
  if (c.env && c.env.EXPLORE_KV) {
      statusStr = await c.env.EXPLORE_KV.get("explore_state") || "null";
  } else {
      statusStr = await getConfig(db, "explore_state", "null");
  }
  
  if (statusStr !== "null") {
      const state = JSON.parse(statusStr);
      if (state.status === 'running') {
         if (!isAdmin) {
             return c.json({ error: "无权操作" }, 403);
         }

         state.status = 'error';
         state.error = '探索已中止';
         const stateStr = JSON.stringify(state);
         if (c.env && c.env.EXPLORE_KV) {
             await c.env.EXPLORE_KV.put("explore_state", stateStr);
         } else {
             await setConfig(db, "explore_state", stateStr);
         }
      }
  }
  return c.json({ success: true });
});

app.post("/explore/reset", async (c) => {
  const db = await getDb(c);
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);

  if (!isAdmin) {
      return c.json({ error: "无权操作" }, 403);
  }

  if (c.env && c.env.EXPLORE_KV) {
      await c.env.EXPLORE_KV.put("explore_state", "null");
  } else {
      await setConfig(db, "explore_state", "null");
  }
  return c.json({ success: true });
});
