import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GoogleGenAI } from "@google/genai";
import { D1DatabaseAdapter, DatabaseAdapter } from "./db.ts";
import { CATEGORIES, FIGURE_POOL } from "./figuresPool.ts";

export const app = new Hono<{ 
  Bindings: { 
    DB?: any;
    IMAGES?: any;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL_ID?: string;
    ADMIN_PASSWORD?: string;
  },
  Variables: { dbAdapter: DatabaseAdapter } 
}>().basePath('/api');

app.onError((err, c) => {
  console.error("Hono error:", err);
  return c.json({ error: err.message || "Internal Server Error" }, 500);
});

// Global for Node fallback
let nodeDbInstance: DatabaseAdapter | null = null;
let dbInitialized = false;

async function getDb(c: any): Promise<DatabaseAdapter> {
  let db: DatabaseAdapter;
  if (c.env && c.env.DB_ADAPTER) {
    // Injected adapter (e.g. from Node server)
    db = c.env.DB_ADAPTER;
  } else if (c.env && c.env.DB) {
    // Native D1 binding
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
      )`,
      `CREATE TABLE IF NOT EXISTS guest_usage (
        ip TEXT,
        date TEXT,
        count INTEGER,
        PRIMARY KEY(ip, date)
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
      "ALTER TABLE people ADD COLUMN birthplace TEXT"
    ];
    for (const m of migrations) {
      try { await db.prepare(m).run(); } catch (e) {}
    }
    dbInitialized = true;
  }
  return db;
}

const getConfig = async (db: DatabaseAdapter, key: string, defaultValue: string = "") => {
  const row = await db.prepare("SELECT value FROM config WHERE key = ?").get(key) as any;
  if (!row || row.value === null || row.value === undefined) return defaultValue;
  return String(row.value);
};

const setConfig = async (db: DatabaseAdapter, key: string, value: string) => {
  await db.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};

function getCSTDate(): string {
    const now = new Date();
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const cstTime = new Date(utcTime + (8 * 3600000));
    return cstTime.toISOString().split('T')[0];
}

async function getRemainingQuota(db: DatabaseAdapter): Promise<number> {
    const limit = parseInt(await getConfig(db, "guest_explore_limit", "5"), 10);
    const date = getCSTDate();
    const row = await db.prepare("SELECT count FROM guest_usage WHERE ip = 'GLOBAL_GUEST' AND date = ?").get(date) as any;
    const used = row ? row.count : 0;
    return Math.max(0, limit - used);
}

async function incrementUsage(db: DatabaseAdapter) {
    const date = getCSTDate();
    await db.prepare(`
        INSERT INTO guest_usage (ip, date, count) 
        VALUES ('GLOBAL_GUEST', ?, 1) 
        ON CONFLICT(ip, date) DO UPDATE SET count = count + 1
    `).run(date);
}

const getAdminPassword = (c: any) => {
    return (c.env && c.env.ADMIN_PASSWORD) || (typeof process !== "undefined" && process.env.ADMIN_PASSWORD) || "admin";
};

async function callAI(c: any, db: DatabaseAdapter, prompt: string, responseFormat: "text" | "json" = "text", schema?: any): Promise<string> {
  const provider = await getConfig(db, "active_model_provider", "gemini");
  
  if (provider === "aliyun") {
    const apiKey = await getConfig(db, "aliyun_api_key");
    const modelId = await getConfig(db, "aliyun_model_id");
    if (!apiKey) throw new Error("缺少 Aliyun API Key");
    if (!modelId) throw new Error("缺少 Aliyun 模型 ID");
    
    const systemContent = `你是一个历史学和百科知识专家。当被要求返回 JSON 时，请严格遵守指定的 schema，且只返回 JSON 原始内容...`;

    const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: prompt }
        ],
        ...(responseFormat === "json" ? { response_format: { type: "json_object" } } : {})
      })
    });
    
    if (!res.ok) throw new Error(`Aliyun API error`);
    const json = await res.json() as any;
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
  } else {
    const apiKey = (await getConfig(db, "gemini_api_key")) || (c.env && c.env.GEMINI_API_KEY) || (typeof process !== "undefined" && process.env.GEMINI_API_KEY);
    const modelId = (await getConfig(db, "gemini_model_id")) || (c.env && c.env.GEMINI_MODEL_ID) || (typeof process !== "undefined" && process.env.GEMINI_MODEL_ID) || "gemini-1.5-flash";
    if (!apiKey) throw new Error("缺少 Gemini API Key");
    if (!modelId) throw new Error("缺少 Gemini 模型 ID");
    
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
  }
}

async function getPortraitUrl(c: any, name: string): Promise<string | null> {
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

    const imagesBucket = c.env?.IMAGES;
    if (imagesBucket && finalUrl) {
        try {
            const imageRes = await fetch(finalUrl, { headers: { "User-Agent": "HistoricalArchiveApp/1.0" } });
            if (!imageRes.ok) throw new Error(`HTTP error ${imageRes.status}`);
            const contentType = imageRes.headers.get("content-type") || "image/jpeg";
            const buffer = await imageRes.arrayBuffer();
            const key = `portraits/${encodeURIComponent(name.toLowerCase())}.jpg`;
            await imagesBucket.put(key, buffer, { httpMetadata: { contentType } });
            
            // If R2 upload is successful, use our own endpoint to serve the image
            return `/api/portraits/${encodeURIComponent(name.toLowerCase())}.jpg`;
        } catch (e) { console.error("R2 Error:", e); }
    }
    return finalUrl;
  } catch (e) {
    return null;
  }
}

async function addRelationship(db: DatabaseAdapter, p1: number, p2: number, type: string) {
  const min = Math.min(p1, p2);
  const max = Math.max(p1, p2);
  try {
    await db.prepare("INSERT INTO relationships (person1_id, person2_id, relationship_type) VALUES (?, ?, ?)").run(min, max, type);
  } catch(e) {}
}

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/portraits/:filename", async (c) => {
  const imagesBucket = c.env?.IMAGES;
  if (!imagesBucket) return c.json({ error: "R2 Image Storage not configured" }, 404);
  
  const filename = c.req.param("filename");
  const object = await imagesBucket.get(`portraits/${filename}`);
  if (!object) return c.json({ error: "Image not found" }, 404);
  
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // Add caching headers to improve performance and save R2 read costs
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
    guest_explore_limit: await getConfig(db, "guest_explore_limit", "5"),
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
  if (body.guest_explore_limit !== undefined) await setConfig(db, "guest_explore_limit", String(body.guest_explore_limit));
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
  
  c.executionCtx.waitUntil((async () => {
    const people = await db.prepare("SELECT * FROM people").all() as any[];
    const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
    const imagesBucket = c.env?.IMAGES;
    if (!imagesBucket) return;
    
    for (const p of people) {
        if (!p.image_url) continue;
        console.log("Repairing image for:", p.name);
        try {
            // Re-fetch from Wikidata to get the true image URL
            let finalUrl = "";
            const searchWikidata = async (lang: string) => {
              const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(p.name)}&language=${lang}&format=json`, { headers });
              const queryData = await res.json();
              if (queryData.search && queryData.search.length > 0) {
                const entity = queryData.search[0];
                const entityRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims&format=json`, { headers });
                const entityData = await entityRes.json();
                const claims = entityData.entities[entity.id].claims;
                if (claims && claims.P18 && claims.P18.length > 0) {
                  const imageName = claims.P18[0].mainsnak.datavalue.value;
                  const md5Res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(imageName)}&prop=imageinfo&iiprop=url&format=json`, { headers });
                  const md5Data = await md5Res.json();
                  const pages = md5Data.query.pages;
                  const pageId = Object.keys(pages)[0];
                  if (pageId !== "-1" && pages[pageId].imageinfo) {
                    return pages[pageId].imageinfo[0].url;
                  }
                }
              }
              return "";
            };
            
            finalUrl = await searchWikidata("zh") || await searchWikidata("en");
            
            if (!finalUrl) {
                const wikiRes = await fetch(`https://zh.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(p.name)}&prop=pageimages&format=json&pithumbsize=500`, { headers });
                const wikiData = await wikiRes.json();
                const pages = wikiData.query.pages;
                const pageId = Object.keys(pages)[0];
                if (pageId !== "-1" && pages[pageId].thumbnail) {
                    finalUrl = pages[pageId].thumbnail.source;
                }
            }
            
            if (finalUrl) {
                const imageRes = await fetch(finalUrl, { headers });
                if (imageRes.ok) {
                    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
                    const buffer = await imageRes.arrayBuffer();
                    const key = `portraits/${encodeURIComponent(p.name.toLowerCase())}.jpg`;
                    await imagesBucket.put(key, buffer, { httpMetadata: { contentType } });
                    const newUrl = `/api/portraits/${encodeURIComponent(p.name.toLowerCase())}.jpg`;
                    await db.prepare("UPDATE people SET image_url = ? WHERE id = ?").run(newUrl, p.id);
                    console.log("Repaired image for:", p.name, "size:", buffer.byteLength);
                } else {
                    console.error("Failed to fetch final url for:", p.name);
                }
            }
        } catch (e) {
            console.error("Repair error for", p.name, e);
        }
    }
  })());

  return c.json({ success: true, message: "Repairing images in background" });
});

app.get("/archive", async (c) => {
  const db = await getDb(c);
  const people = await db.prepare("SELECT * FROM people ORDER BY created_at DESC").all() as any[];
  const relationships = await db.prepare("SELECT * FROM relationships").all();
  
  const syncTask = (async () => {
      const imagesBucket = c.env?.IMAGES;
      if (!imagesBucket) return;
      for (const p of people) {
          if (p.image_url && p.image_url.startsWith("http") && !p.image_url.includes("/api/portraits/")) {
              try {
                  const imageRes = await fetch(p.image_url, { headers: { "User-Agent": "HistoricalArchiveApp/1.0" } });
                  if (imageRes.ok) {
                      const contentType = imageRes.headers.get("content-type") || "image/jpeg";
                      const buffer = await imageRes.arrayBuffer();
                      const key = `portraits/${encodeURIComponent(p.name.toLowerCase())}.jpg`;
                      await imagesBucket.put(key, buffer, { httpMetadata: { contentType } });
                      const newUrl = `/api/portraits/${encodeURIComponent(p.name.toLowerCase())}.jpg`;
                      await db.prepare("UPDATE people SET image_url = ? WHERE id = ?").run(newUrl, p.id);
                  }
              } catch (e) {
                  console.error(`Sync image error for ${p.name}:`, e);
              }
          }
      }
  })();

  try {
      if (c.executionCtx && c.executionCtx.waitUntil) {
          c.executionCtx.waitUntil(syncTask);
      } else {
          syncTask.catch(console.error);
      }
  } catch (e) {
      syncTask.catch(console.error);
  }

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
      remainingQuota: await getRemainingQuota(db)
  });
});

app.get("/usage/remaining", async (c) => {
  const db = await getDb(c);
  return c.json({ remaining: await getRemainingQuota(db) });
});

app.post("/usage/record", async (c) => {
  const db = await getDb(c);
  await incrementUsage(db);
  return c.json({ success: true, remaining: await getRemainingQuota(db) });
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

  const people = await db.prepare("SELECT id, name, raw_relationships FROM people").all() as any[];
  const relationships = await db.prepare("SELECT * FROM relationships").all() as any[];

  const nameToId = new Map(people.map(p => [p.name, p.id]));
  const idToName = new Map(people.map(p => [p.id, p.name]));

  const adj = new Map<number, { id: number, type: string }[]>();
  relationships.forEach(r => {
    if (!adj.has(r.person1_id)) adj.set(r.person1_id, []);
    if (!adj.has(r.person2_id)) adj.set(r.person2_id, []);
    adj.get(r.person1_id)!.push({ id: r.person2_id, type: r.relationship_type });
    adj.get(r.person2_id)!.push({ id: r.person1_id, type: r.relationship_type });
  });

  people.forEach(p => {
    try {
      const raw = JSON.parse(p.raw_relationships || "[]");
      raw.forEach((r: any) => {
        if (!r.personName) return;
        const targetId = nameToId.get(r.personName);
        if (targetId !== undefined && targetId !== p.id) {
          if (!adj.has(p.id)) adj.set(p.id, []);
          if (!adj.get(p.id)!.some(n => n.id === targetId)) adj.get(p.id)!.push({ id: targetId, type: r.relationshipType || "历史关联" });
          if (!adj.has(targetId)) adj.set(targetId, []);
          if (!adj.get(targetId)!.some(n => n.id === p.id)) adj.get(targetId)!.push({ id: p.id, type: r.relationshipType || "历史关联" });
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
      if (id === endId) return c.json({ path });

      const neighbors = adj.get(id) || [];
      for (const n of neighbors) {
        if (!visited.has(n.id)) {
          visited.add(n.id);
          queue.push({ id: n.id, path: [...path, { name: idToName.get(n.id)!, type: n.type }] });
        }
      }
    }
  }

  return c.json({ path: null });
});

app.post("/archiver/chat", async (c) => {
  const db = await getDb(c);
  const { person1, person2 } = await c.req.json();
  if (!person1 || !person2) return c.json({ error: "Missing person1 or person2" }, 400);

  const prompt = `你是剧作家。请为历史上的这两位人物编写一段跨时空的两人对话。
人物1：${person1}
人物2：${person2}
要求：
1. 一共2轮对话（也就是每人说2句话，共4句话）。
2. 每句话的字数要极度简练（字数不要太多，每句时长不能超过2秒的阅读时间该有多长就多长，大概不超过15-20字），总字数控制在8秒阅读长度内。
3. 对话风格：幽默、哲思、有趣、接地气，且必须符合两人的历史身份、核心思想与标志性气质。
4. 格式：严格返回一个JSON对象，包含messages数组，如下：
{
  "messages": [
    { "speaker": "${person1}", "text": "..." },
    { "speaker": "${person2}", "text": "..." },
    { "speaker": "${person1}", "text": "..." },
    { "speaker": "${person2}", "text": "..." }
  ]
}
不包含任何其他Markdown内容或多余文字。
`;

  try {
    const chatContent = await callAI(c, db, prompt, "json", {
      type: "OBJECT",
      properties: {
        messages: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              speaker: { type: "STRING" },
              text: { type: "STRING" }
            },
            required: ["speaker", "text"]
          }
        }
      },
      required: ["messages"]
    });
    
    let messages = [];
    try {
       const parsed = JSON.parse(chatContent);
       messages = parsed.messages || [];
    } catch(err) {
       // fallback parsing
       const startIndex = chatContent.indexOf('[');
       const endIndex = chatContent.lastIndexOf(']') + 1;
       const jsonStr = chatContent.slice(startIndex, endIndex);
       messages = JSON.parse(jsonStr);
    }
    return c.json({ messages });
  } catch (error: any) {
    console.error("Chat generation error:", error);
    return c.json({ error: "Failed to generate dialogue", details: error?.message || String(error) }, 500);
  }
});

app.get("/archiver/random-pair", async (c) => {
  const db = await getDb(c);
  const count = await db.prepare("SELECT COUNT(*) as count FROM people").get() as { count: number };
  if (count.count < 2) return c.json({ error: "Need at least 2 people in database" }, 400);
  const people = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 2").all() as any[];
  return c.json({ sourceName: people[0].name, targetName: people[1].name });
});

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
  const existingNames = (await db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name).join("、");
  
  try {
      const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。要求不包含在列表中：[${existingNames.slice(0, 500)}]，关联：${sourceName || ''}`;
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

  const existingNames = (await db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name).join("、");

  if (!targetName) {
      const existing = (await db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name);
      return c.json({ error: "Missing target" }, 400); // Simplified
  }

  if (stream) {
      const pass = c.req.header("x-admin-password");
      const isAdmin = pass === getAdminPassword(c);

      if (!isAdmin && await getRemainingQuota(db) <= 0) {
          return c.json({ error: "今日探索次数已达上限" }, 403);
      }

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
              重要：必须至少包含 1 个以下已入库人物：[${existingNames.slice(0, 500)}]。`;

              let resultText = await callAI(c, db, prompt, "json");
              let data: any = {};
              try {
                  let rawData = JSON.parse(resultText || "{}");
                  data = Array.isArray(rawData) && rawData.length > 0 ? rawData[0] : rawData;
              } catch (e) {
                  // Fallback
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

              if (!isAdmin) {
                  await incrementUsage(db);
                  await send({ type: 'usage-update', remaining: await getRemainingQuota(db) });
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
