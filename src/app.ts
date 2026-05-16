import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GoogleGenAI } from "@google/genai";
import { D1DatabaseAdapter, DatabaseAdapter } from "./db.ts";
import { CATEGORIES, FIGURE_POOL } from "./figuresPool.ts";
import { ARCHIVE_PROMPT, ARCHIVE_SCHEMA, EXPAND_CONNECTIONS_PROMPT, EXPAND_CONNECTIONS_SCHEMA } from "./services/aiService.ts";
import { runExplorationTask } from "./exploreTask.ts";

const root = new Hono<{ 
  Bindings: { 
    DB?: any;
    IMAGES?: any;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL_ID?: string;
    ADMIN_PASSWORD?: string;
  },
  Variables: { dbAdapter: DatabaseAdapter } 
}>();

export const app = root.basePath('/api');

app.onError((err, c) => {
  console.error("Hono error:", err);
  return c.json({ error: err.message || "Internal Server Error", stack: typeof process !== 'undefined' && process.env.NODE_ENV === 'development' ? err.stack : undefined }, 500);
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

export async function callAI(c: any, db: DatabaseAdapter, prompt: string, responseFormat: "text" | "json" = "text", schema?: any, onStreamPulse?: () => Promise<void>): Promise<string> {
  const provider = await getConfig(db, "active_model_provider", "gemini");
  
  // Set up an active async heartbeat loop. In Cloudflare Workers, setInterval 
  // can sometimes be suspended during long I/O fetch waits. An explicit async 
  // loop keeps the isolate event loop actively pulsing the SSE connection.
  let isFetching = true;
  let heartbeatPromise: Promise<void> | null = null;
  if (onStreamPulse) {
      heartbeatPromise = (async () => {
          while (isFetching) {
              await new Promise(r => setTimeout(r, 8000));
              if (!isFetching) break;
              try { await onStreamPulse(); } catch(e) { console.error("Pulse error", e); }
          }
      })();
  }

  const cleanup = () => {
      isFetching = false;
  };
  
  if (provider === "aliyun") {
    const apiKey = await getConfig(db, "aliyun_api_key");
    const modelId = await getConfig(db, "aliyun_model_id");
    if (!apiKey) { cleanup(); throw new Error("缺少 Aliyun API Key"); }
    if (!modelId) { cleanup(); throw new Error("缺少 Aliyun 模型 ID"); }
    
    const systemContent = `你是一个历史学和百科知识专家。当被要求返回 JSON 时，请严格遵守指定的 schema，且只返回 JSON 原始内容。不要包含任何 Markdown 格式。`;

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000); // 180s timeout

    let pulseTimer: any;
    if (onStreamPulse) {
      pulseTimer = setInterval(async () => {
          if (!isFetching) return;
          try {
            await onStreamPulse();
          } catch(e) {}
      }, 5000); // Pulse every 5s instead of 8s for better stability
    }

    const aliyunCleanup = () => {
      isFetching = false;
      if (pulseTimer) clearInterval(pulseTimer);
      clearTimeout(timeoutId);
    };

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
          stream: true,
          ...(responseFormat === "json" ? { response_format: { type: "json_object" } } : {})
        })
      });
      
      if (!res.ok) {
        clearTimeout(timeoutId);
        aliyunCleanup();
        console.error(`Aliyun API error: ${res.status} ${res.statusText}`);
        throw new Error(`Aliyun API error`);
      }

      if (!res.body) {
        throw new Error("No response body");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullContent = "";
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ') && !trimmed.includes('[DONE]')) {
            try {
              const data = JSON.parse(trimmed.substring(6));
              const delta = data.choices[0]?.delta?.content || "";
              fullContent += delta;
            } catch (e) {
              // ignore parse errors for partial chunks
            }
          }
        }
      }
      if (buffer.trim().startsWith('data: ') && !buffer.includes('[DONE]')) {
        try {
          const data = JSON.parse(buffer.trim().substring(6));
          fullContent += data.choices[0]?.delta?.content || "";
        } catch(e) {}
      }
      
      clearTimeout(timeoutId);
      aliyunCleanup();
      
      if (!fullContent) {
        throw new Error("API 未返回任何有效内容，可能触发了安全拦截。");
      }
      
      const duration = Date.now() - startTime;
      console.log(`Aliyun call took ${duration}ms`);
      let content = fullContent;
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
      aliyunCleanup();
      if (err.name === 'AbortError') throw new Error("AI 调用超时 (300s)");
      throw err;
    }
  } else {
    const apiKey = (await getConfig(db, "gemini_api_key")) || (c.env && c.env.GEMINI_API_KEY) || (typeof process !== "undefined" && process.env.GEMINI_API_KEY);
    const modelId = (await getConfig(db, "gemini_model_id")) || (c.env && c.env.GEMINI_MODEL_ID) || (typeof process !== "undefined" && process.env.GEMINI_MODEL_ID) || "gemini-1.5-flash";
    if (!apiKey) { cleanup(); throw new Error("缺少 Gemini API Key"); }
    if (!modelId) { cleanup(); throw new Error("缺少 Gemini 模型 ID"); }
    
    const ai = new GoogleGenAI({ apiKey });
    const startTime = Date.now();
    try {
      let timeoutId: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Timeout")), 180000); // 180s timeout as requested
      });

      const generateContentStreamPromise = async () => {
        const stream = await ai.models.generateContentStream({
          model: modelId,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: responseFormat === "json" ? { 
            responseMimeType: "application/json",
            responseSchema: schema 
          } : undefined
        });
        let fullText = "";
        for await (const chunk of stream) {
           fullText += chunk.text;
        }
        return fullText;
      };

      const result = await Promise.race([generateContentStreamPromise(), timeoutPromise]) as string;
      clearTimeout(timeoutId);
      cleanup();

      const duration = Date.now() - startTime;
      console.log(`Gemini call took ${duration}ms`);
      let content = result;
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
      cleanup();
      const duration = Date.now() - startTime;
      console.error(`Gemini call failed after ${duration}ms:`, err);
      if (err.message === "Timeout") throw new Error("AI 调用超时 (120s)");
      throw err;
    }
  }
}

export async function fetchMetadataFromWiki(name: string) {
  const headers = { "User-Agent": "HistoricalArchiveApp/1.0 (zhiduanchangyu@gmail.com)" };
  try {
    const searchRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=zh&format=json`, { headers });
    const searchData = await searchRes.json() as any;
    const entity = searchData.search?.[0];
    
    if (entity) {
      const entityId = entity.id;
      const entityRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=claims|descriptions|labels&languages=zh|en&format=json`, { headers });
      const entityData = await entityRes.json() as any;
      const item = entityData.entities[entityId];
      
      const zhLabel = item.labels?.zh?.value;
      const description = item.descriptions?.zh?.value || item.descriptions?.en?.value || entity.description || "";
      const claims = item.claims || {};
      let imageUrl = "";
      
      if (claims.P18 && claims.P18.length > 0) {
        const imageName = claims.P18[0].mainsnak?.datavalue?.value;
        if (imageName) {
          const encodedImageName = encodeURIComponent(imageName.replace(/ /g, '_'));
          imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedImageName}?width=500`;
        }
      }
      
      return {
        normalizedName: zhLabel || entity.label || name,
        description,
        imageUrl: imageUrl || null
      };
    }
    
    // Fallback to Wikipedia search for snippet if Wikidata yields nothing
    const wikiRes = await fetch(`https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json`, { headers });
    const wikiData = await wikiRes.json() as any;
    const wikiItem = wikiData.query?.search?.[0];
    if (wikiItem) {
        return {
            normalizedName: wikiItem.title,
            description: (wikiItem.snippet || "").replace(/<[^>]*>?/gm, ''),
            imageUrl: null
        };
    }

    return { normalizedName: name, description: "", imageUrl: null };
  } catch (e) {
    console.error("Wiki/Wikidata fetch error:", e);
    return { normalizedName: name, description: "", imageUrl: null };
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
  
  const nameString = String(filename || "");
  const name = decodeURIComponent(nameString.replace(/\.jpg$/i, ''));
  const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
  
  try {
    let finalUrl = "";
    
    // Search in Wikipedia/Wikidata
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
      const item = entityData.entities[entity.id];
      if (item && item.claims && item.claims.P18 && item.claims.P18.length > 0) {
        const imageName = item.claims.P18[0].mainsnak?.datavalue?.value;
        if (imageName) {
          finalUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName.replace(/ /g, '_'))}?width=500`;
        }
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
        
        if (imagesBucket) {
           // We derive the canonical key here
           const canonicalKey = `portraits/${encodeURIComponent(name.toLowerCase())}.jpg`;
           await imagesBucket.put(canonicalKey, buffer, { httpMetadata: { contentType: contentType } });
        }
        
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
  const rawFilename = c.req.param("filename");
  // Hono param is decoded, so we re-normalize it for R2 search
  const namePart = rawFilename.replace(/\.jpg$/i, '');
  const r2Key = `portraits/${encodeURIComponent(namePart.toLowerCase())}.jpg`;
  
  if (imagesBucket) {
    let object = await imagesBucket.get(r2Key);
    
    if (!object) {
      const result = await fetchAndStoreImage(c, rawFilename);
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
  } else {
    // If no R2 bucket (e.g. in AI Studio preview), just fetch and stream
    const result = await fetchAndStoreImage(c, rawFilename);
    if (result) {
      const headers = new Headers();
      headers.set("Content-Type", result.contentType);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(result.body as any, { headers });
    }
    return c.json({ error: "Image not found (No R2)" }, 404);
  }
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
    cron_interval_enabled: await getConfig(db, "cron_interval_enabled", "false") === "true",
    cron_interval_hours: parseInt(await getConfig(db, "cron_interval_hours", "0")),
    cron_interval_minutes: parseInt(await getConfig(db, "cron_interval_minutes", "15")),
    last_cron_trigger_time: await getConfig(db, "last_cron_trigger_time", "")
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
  
  if (body.cron_interval_enabled !== undefined) await setConfig(db, "cron_interval_enabled", String(body.cron_interval_enabled));
  if (body.cron_interval_hours !== undefined) await setConfig(db, "cron_interval_hours", String(body.cron_interval_hours));
  if (body.cron_interval_minutes !== undefined) await setConfig(db, "cron_interval_minutes", String(body.cron_interval_minutes));
  
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
  
  // Get person info for R2 deletion
  const person = await db.prepare("SELECT name FROM people WHERE id = ?").get(id) as any;
  if (person && c.env?.IMAGES) {
    try {
      const key = `portraits/${encodeURIComponent(person.name.toLowerCase())}.jpg`;
      await c.env.IMAGES.delete(key);
    } catch (e) {
      console.error(`Failed to delete portrait from R2 for ${person.name}:`, e);
    }
  }

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
  
  // Get people names for R2 deletion
  const people = await db.prepare(`SELECT name FROM people WHERE id IN (${placeholders})`).all(...ids) as any[];
  if (c.env?.IMAGES) {
    for (const person of people) {
      try {
        const key = `portraits/${encodeURIComponent(person.name.toLowerCase())}.jpg`;
        await c.env.IMAGES.delete(key);
      } catch (e) {
        console.error(`Failed to delete portrait from R2 for ${person.name}:`, e);
      }
    }
  }

  await db.prepare(`DELETE FROM relationships WHERE person1_id IN (${placeholders}) OR person2_id IN (${placeholders})`).run(...ids, ...ids);
  await db.prepare(`DELETE FROM people WHERE id IN (${placeholders})`).run(...ids);
  return c.json({ success: true });
});

app.post("/admin/people/:id/expand-connections", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const id = c.req.param("id");
  
  // 1. Get current person info
  const person = await db.prepare("SELECT * FROM people WHERE id = ?").get(id) as any;
  if (!person) return c.json({ error: "Person not found" }, 404);

  // 2. Get existing connection IDs (members of the same archive)
  const existingConnections = await db.prepare(`
    SELECT person1_id as other_id FROM relationships WHERE person2_id = ?
    UNION
    SELECT person2_id as other_id FROM relationships WHERE person1_id = ?
  `).all(id, id) as any[];
  const existingIds = new Set(existingConnections.map(cc => cc.other_id));
  existingIds.add(parseInt(id));

  // 3. Get up to 50 candidates (archived people not connected)
  const candidates = await db.prepare("SELECT name FROM people WHERE id NOT IN (" + Array.from(existingIds).join(",") + ") ORDER BY RANDOM() LIMIT 50").all() as any[];
  
  let addedCount = 0;
  let newRels = [];

  if (candidates.length > 0) {
      // 4. Call AI to find links among archived people
      const prompt = EXPAND_CONNECTIONS_PROMPT(person.name, person.biography, candidates.map(c => c.name));
      try {
          const resultText = await callAI(c, db, prompt, "json", EXPAND_CONNECTIONS_SCHEMA);
          newRels = JSON.parse(resultText || "[]");
          
          for (const rel of newRels) {
              const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
              if (matched) {
                  await addRelationship(db, parseInt(id), matched.id, rel.relationshipType);
                  addedCount++;
              }
          }
      } catch (e: any) {
          console.error("Expand connections link-building error:", e);
      }
  }

  // 5. If no links were added, fallback: pick an unarchived person from raw_relationships to archive
  if (addedCount === 0) {
      const archivedPeopleRows = await db.prepare("SELECT name FROM people").all() as any[];
      const archivedNames = new Set(archivedPeopleRows.map(p => p.name));
      
      let rawRels = [];
      try {
          rawRels = JSON.parse(person.raw_relationships || "[]");
      } catch (e) {}

      const unarchivedCandidates = rawRels
          .map((r: any) => r.personName)
          .filter((name: string) => name && !archivedNames.has(name));

      if (unarchivedCandidates.length > 0) {
          const fallbackPrompt = `你是一位历史策展人。人物 "${person.name}" 的原始关联中有一些尚未正式入库的历史人物：[${unarchivedCandidates.join("、")}]。\n请从中挑选出一名您认为最重要/最知名/最值得入库的人物，并给出推荐理由。\n\n请严格返回以下格式的 JSON：\n{ "name": "标准中文译名", "reason": "推荐收录理由(20字内)" }`;
          try {
              const pickedRaw = await callAI(c, db, fallbackPrompt, "json", {
                  type: "object",
                  properties: {
                      name: { type: "string" },
                      reason: { type: "string" }
                  },
                  required: ["name", "reason"]
              });
              const picked = JSON.parse(pickedRaw || "{}");
              if (picked.name && unarchivedCandidates.includes(picked.name)) {
                  return c.json({ success: true, addedCount: 0, fallbackArchive: picked });
              }
          } catch (e) {
              console.error("Expand connections fallback error:", e);
          }
      }
  }
  
  return c.json({ success: true, addedCount });
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
  let people = await db.prepare(`
    SELECT p.*, 
    (SELECT COUNT(*) FROM relationships WHERE person1_id = p.id OR person2_id = p.id) as connectionsCount
    FROM people p
    ORDER BY created_at DESC
  `).all() as any[];
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

    let connCount = 0;
    if (data.relationships && Array.isArray(data.relationships)) {
        for (const rel of data.relationships) {
            const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
            if (matched) {
                await addRelationship(db, inserted.id, matched.id, rel.relationshipType);
                connCount++;
            }
        }
    }
    
    const previousMentions = await db.prepare(`SELECT id, name, raw_relationships FROM people WHERE id != ? AND raw_relationships LIKE ?`).all(inserted.id, `%${name}%`) as any[];
    for (const p of previousMentions) {
        try {
            const rels = JSON.parse(p.raw_relationships || "[]");
            const matchingRel = rels.find((r: any) => r.personName === name);
            if (matchingRel) {
                await addRelationship(db, p.id, inserted.id, matchingRel.relationshipType);
                connCount++;
            }
        } catch(e) {}
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
  const { person1, person2 } = await c.req.json();
  if (!person1 || !person2) return c.json({ error: "Missing names" }, 400);

  try {
      const p1Data = await db.prepare("SELECT name, biography FROM people WHERE name = ? COLLATE NOCASE").get(person1) as any;
      const p2Data = await db.prepare("SELECT name, biography FROM people WHERE name = ? COLLATE NOCASE").get(person2) as any;
      
      if (!p1Data || !p2Data) return c.json({ error: "人物档案尚未入库，无法开启跨时空对话" }, 404);

      const prompt = `你正在主持一场跨越时空的对话。
人物 A: ${p1Data.name}，传记: ${p1Data.biography}
人物 B: ${p2Data.name}，传记: ${p2Data.biography}

请模拟这两人之间的一段简短、深刻且符合性格特征的对话（3-4个来回）。
对话应围绕他们的核心思想、成就或历史遗憾展开。
每句话长度必须限制在 1~20 个汉字。
请直接返回 JSON 数组，格式如下：
[
  { "speaker": "${p1Data.name}", "text": "..." },
  { "speaker": "${p2Data.name}", "text": "..." },
  ...
]
只返回 JSON 代码块，不要包含 Markdown 格式。`;

      const result = await callAI(c, db, prompt, "json", {
          type: "array",
          items: {
              type: "object",
              properties: {
                  speaker: { type: "string" },
                  text: { type: "string" }
              },
              required: ["speaker", "text"]
          }
      });

      const messages = JSON.parse(result || "[]");
      // Enforce dialog length limit on the backend result just in case
      const validatedMessages = messages.map((m: any) => ({
          speaker: m.speaker,
          text: (m.text || "").substring(0, 20)
      }));
      return c.json({ messages: validatedMessages });
  } catch (e: any) {
      console.error("Chat error:", e);
      return c.json({ error: "跨时空通讯信号中断: " + e.message }, 500);
  }
});

app.get("/archiver/random-pair", async (c) => {
  const db = await getDb(c);
  const count = await db.prepare("SELECT COUNT(*) as count FROM people").get() as { count: number };
  if (count.count < 2) return c.json({ error: "Need at least 2 people in database" }, 400);
  const people = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 2").all() as any[];
  return c.json({ sourceName: people[0].name, targetName: people[1].name });
});

async function pickTarget(db: DatabaseAdapter) {
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

  // Priority 1: 1 from pool
  if (uniquePoolUnarchived.length >= 1) {
      const picked = shuffle([...uniquePoolUnarchived])[0];
      return { targetName: picked, strategy: "pool" };
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

  if (uniqueRelsUnarchived.length >= 1) {
      const picked = shuffle([...uniqueRelsUnarchived])[0];
      return { targetName: picked, strategy: "relationships" };
  }
  
  // Fallback: Empty state
  return { 
     targetName: "",
     isEmpty: true
  };
}

app.post("/archiver/admin-pick-target", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  return c.json(await pickTarget(db));
});

app.post("/archiver/pick-target", async (c) => {
  const db = await getDb(c);
  return c.json(await pickTarget(db));
});

app.post("/archiver/generate-target", async (c) => {
  const db = await getDb(c);
  const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 20").all() as any[];
  const sampleNames = samplePeople.map((p: any) => p.name).join("、");
  
  const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。
要求：
1. 不包含在以下列表中：[${sampleNames}]
2. 此人必须在 Wikidata/Wikipedia 有详尽记载。
3. 请只返回此人的标准中文译名，不带任何其他文字。`;

  try {
      const resultText = await callAI(c, db, prompt, "text");
      const targetName = (resultText || "").trim().replace(/[「」""'']/g, "");
      return c.json({ targetName });
  } catch(e: any) {
      return c.json({ error: e.message }, 500);
  }
});

app.post("/archive-figure", async (c) => {
  const db = await getDb(c);
  const { personName, stream: isStream } = await c.req.json();
  let targetName = personName;

  const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 20").all() as any[];
  const sampleNames = samplePeople.map(p => p.name).join("、");

  if (isStream) {
      const pass = c.req.header("x-admin-password");
      const isAdmin = pass === getAdminPassword(c);

      return streamSSE(c, async (stream) => {
          const send = async (data: any) => await stream.writeSSE({ data: JSON.stringify(data) });
          try {
              if (!targetName) {
                  await send({ type: 'info', msg: `未指定人物，正在检索图谱以寻找合适目标...` });
                  const existingSet = new Set(samplePeople.map(p => p.name));
                  const unarchivedInPool: string[] = [];
                  for (const cat of CATEGORIES) {
                      FIGURE_POOL[cat]?.forEach(n => { if (!existingSet.has(n)) unarchivedInPool.push(n); });
                  }
                  if (unarchivedInPool.length > 0) {
                      targetName = unarchivedInPool[Math.floor(Math.random() * unarchivedInPool.length)];
                      await send({ type: 'info', msg: `从预设池中随机选中: ${targetName}` });
                  } else {
                      await send({ type: 'info', msg: `预设池已满，正在进行 AI 随机发散...` });
                      const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。要求不包含在已知列表中：[${sampleNames} ...]`;
                      const resultText = await callAI(c, db, prompt, "text");
                      targetName = (resultText || "").trim().replace(/[「」""'']/g, "");
                      await send({ type: 'info', msg: `AI 随机发散选中: ${targetName}` });
                  }
              }

              if (!targetName) throw new Error("无法确定目标");

              await send({ type: 'info', msg: `正在从 Wikidata/Wikipedia 唤醒 ${targetName} 的记忆...`, data: { name: targetName } });
              const meta = await fetchMetadataFromWiki(targetName);
              targetName = meta.normalizedName;

              await send({ type: 'info', msg: `确定抓取目标: ${targetName}`, data: { normalizedName: targetName, metaFound: !!meta.description } });
              if (meta.description) {
                  await send({ type: 'info', msg: `识别到身份线索: ${meta.description}` });
              }
              await send({ type: 'info', msg: `正在利用 AI 深度检索并编织 ${targetName} 的历史时空数据...`, data: { categories: CATEGORIES } });
              
              const prompt = ARCHIVE_PROMPT(targetName, CATEGORIES, sampleNames, meta.description);

              await send({ type: 'ai-req', msg: 'AI 代理请求发送', data: { prompt: prompt.substring(0, 300) + "..." } });
              let resultText = await callAI(c, db, prompt, "json", ARCHIVE_SCHEMA(!!meta.description), async () => {
                  await send({ type: 'heartbeat', msg: 'AI 仍在思考中...' });
              });
              await send({ type: 'ai-res', msg: 'AI 响应解码成功', data: { rawText: resultText.substring(0, 200) + "..." } });

              let data: any = {};
              try {
                  data = JSON.parse(resultText || "{}");
              } catch (e) {
                  data = { category: "其他", biography: "资料解析失败", achievements: [], relationships: [], standardChineseName: targetName };
              }

              if (!data.accepted && !isAdmin) {
                 await send({ type: 'error', msg: `抱歉，${targetName} 可能不符合入库标准（${data.reason || "非真实历史人物"}）` });
                 return;
              }

              // Use the standard Chinese name as the canonical record name
              const finalName = data.standardChineseName || targetName;

              await send({ type: 'info', msg: `正在获取 ${finalName} 的历史肖像...` });
              const portraitUrlRaw = meta.imageUrl || `https://image.pollinations.ai/prompt/${encodeURIComponent("Historical portrait of " + finalName + ", realistic oil painting style, highly detailed")}`;
              
              const portraitUrl = `/api/portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`;

              await send({ type: 'info', msg: `正在将 ${finalName} 录入时空档案馆...` });
              
              const existing = await db.prepare("SELECT id FROM people WHERE name = ?").get(finalName) as any;
              
              if (existing) {
                  await send({ type: 'info', msg: `${finalName} 已存在，正在更新资料...` });
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
                  finalName, data.category || "其他", data.keyword || "", data.lifespan || "", data.birthplace || "", data.biography || "",
                  JSON.stringify(data.achievements || []), portraitUrl, JSON.stringify(data.relationships || []), data.latitude || 0, data.longitude || 0
              ) as { id: number };
              const personId = inserted.id;

              // Try to store the image if we have a bucket
              if (c.env?.IMAGES && portraitUrlRaw) {
                  try {
                    const imgRes = await fetch(portraitUrlRaw);
                    if (imgRes.ok) {
                        const buffer = await imgRes.arrayBuffer();
                        await c.env.IMAGES.put(`portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`, buffer, {
                            httpMetadata: { contentType: imgRes.headers.get("content-type") || "image/jpeg" }
                        });
                    }
                  } catch(e) {}
              }

              let connCount = 0;
              // 1. 主动连接：检测该人物声明的关系，是否在数据库中已存在
              if (data.relationships && Array.isArray(data.relationships)) {
                  for (const rel of data.relationships) {
                      const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
                      if (matched) {
                          await addRelationship(db, personId, matched.id, rel.relationshipType);
                          connCount++;
                      }
                  }
              }

              // 2. 被动追溯：检测库中已有的人物，是否曾经将关系连向了当前这名新入库人物
              const previousMentions = await db.prepare(`SELECT id, name, raw_relationships FROM people WHERE id != ? AND (raw_relationships LIKE ? OR raw_relationships LIKE ?)`).all(personId, `%${finalName}%`, `%${targetName}%`) as any[];
              for (const p of previousMentions) {
                  try {
                      const rels = JSON.parse(p.raw_relationships || "[]");
                      const matchingRel = rels.find((r: any) => r.personName === finalName || r.personName === targetName);
                      if (matchingRel) {
                          await addRelationship(db, p.id, personId, matchingRel.relationshipType);
                          connCount++;
                      }
                  } catch(e) {}
              }

              if (connCount > 0) await send({ type: 'info', msg: `成功匹配并建立 ${connCount} 条时空连接。` });
              else await send({ type: 'info', msg: `未发现即时时空连接，已保留关联索引供后续追溯。` });


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

  let statusStr = await getConfig(db, "explore_state", "null");
  if (statusStr === "null") return c.json(null);
  const data = JSON.parse(statusStr);
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
  
  if (data && data.status === 'running') {
      const diff = data.lastHeartbeat ? (Date.now() - data.lastHeartbeat) : Infinity;
      if (diff > 600000) { // 600 seconds (10 minutes)
          data.status = 'error';
          data.error = '探索任务被系统认定为已脱机（持续 >600s 无响应）。可能由于大模型 API 限流或响应过慢导致请求彻底熔断。请检查 API 状态后重试。';
          const newState = JSON.stringify(data);
          await setConfig(db, "explore_state", newState);
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

app.post("/explore/ai-proxy", async (c) => {
  const db = await getDb(c);
  const { prompt, responseFormat, schema } = await c.req.json();
  try {
      const text = await callAI(c, db, prompt, responseFormat, schema);
      return c.json({ text });
  } catch (e: any) {
      return c.json({ error: e.message }, 500);
  }
});

app.post("/explore/start", async (c) => {
  const db = await getDb(c);
  const { target, isAdmin, clientTaskId } = await c.req.json();
  let currentStr = await getConfig(db, "explore_state", "null");
  if (currentStr !== "null") {
      const current = JSON.parse(currentStr);
      const isStale = current.status === 'running' && (!current.lastHeartbeat || (Date.now() - current.lastHeartbeat > 600000)); // 600 seconds
      
      if (current.status === 'running' && !isStale) {
          return c.json({ error: "探索正在进行中，请稍候。若任务已长久挂起，请重置状态后重试。" }, 400);
      }
      
      if (isStale) {
          console.warn("Detected stale exploration task, allowing override.");
      }
  }
  
  // Set initial state synchronously so immediately following reads see it
  // Ensure logs and steps are completely fresh
  const newTaskId = clientTaskId || Date.now();
  const initialState = {
      status: 'running', 
      target, 
      taskId: newTaskId,
      logs: [{ timestamp: new Date().toLocaleTimeString(), msg: `初始化任务: [${target || '随机发散探索'}]`, type: 'info' }], 
      steps: [{ msg: "探索序列启动中...", status: "pending", startTime: Date.now() }], 
      path: null, 
      error: null, 
      newArrivals: [],
      lastHeartbeat: Date.now()
  };
  const stateStr = JSON.stringify(initialState);
  await setConfig(db, "explore_state", stateStr);

  // Return SSE to keep the Cloudflare Worker isolate alive while the AI is computing
  return streamSSE(c, async (stream) => {
      // Re-bind the pulse callback to also write to the stream
      const originalPulse = async (msg: string) => {
          if (msg !== 'heartbeat') console.log(`[Explore Pulse] ${msg}`);
          try {
             await stream.writeSSE({ data: JSON.stringify({ type: msg === 'heartbeat' ? 'ping' : 'msg', text: msg }) });
          } catch (e) {
             // Client might have disconnected, ignore
          }
      };

      // Create a background promise that tracks the task
      const taskWithStream = runExplorationTask(
          db, target, callAI, getConfig, setConfig, addRelationship, 
          ARCHIVE_PROMPT, ARCHIVE_SCHEMA, 
          fetchMetadataFromWiki, c, !!isAdmin,
          originalPulse,
          newTaskId
      );

      if (c.executionCtx && c.executionCtx.waitUntil) {
          c.executionCtx.waitUntil(taskWithStream.catch((e: any) => console.error("Background task error:", e)));
      }

      try {
          await taskWithStream;
      } catch (err: any) {
          console.error("Task execution error:", err);
      } finally {
          try {
              await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
          } catch (e) {}
      }
  });
});

app.post("/explore/stop", async (c) => {
  const db = await getDb(c);
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);

  let statusStr = await getConfig(db, "explore_state", "null");
  
  if (statusStr !== "null") {
      const state = JSON.parse(statusStr);
      if (state.status === 'running') {
         if (!isAdmin) {
             return c.json({ error: "无权操作" }, 403);
         }

         state.status = 'error';
         state.error = '探索已中止';
         const stateStr = JSON.stringify(state);
         await setConfig(db, "explore_state", stateStr);
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

  await setConfig(db, "explore_state", "null");
  return c.json({ success: true });
});

// Added cron endpoint
app.post("/cron", async (c) => {
    const now = Date.now();
    console.trace(`[Cron Worker] ${new Date(now).toISOString()} 后台成功收到 worker 触发的消息`);
    const secret = c.req.query("secret");
    const force = c.req.query("force") === "true";

    if (secret !== "update_celeb") {
        return c.json({ error: "Unauthorized" }, 401);
    }
    
    const db = await getDb(c);
    
    // 检查是否已经有探索任务在运行
    let currentStr = await getConfig(db, "explore_state", "null");

    if (currentStr !== "null") {
        try {
            const current = JSON.parse(currentStr);
            const isStale = current.status === 'running' && (!current.lastHeartbeat || (Date.now() - current.lastHeartbeat > 600000));
            
            if (current.status === 'running' && !isStale) {
                console.log("[Cron Skip] 探索正在进行中，跳过本次触发");
                return c.json({ status: "skipped", message: "探索正在进行中，跳过本次触发" });
            }
        } catch(e) {
            console.error("[Cron] 解析状态失败:", e);
        }
    }

    // Check interval (unless forced)
    const intervalEnabled = await getConfig(db, "cron_interval_enabled", "false") === "true";
    const lastTrigger = await getConfig(db, "last_cron_trigger_time", "");
    
    if (!force && intervalEnabled && lastTrigger) {
        const lastTime = parseInt(lastTrigger);
        const hours = parseInt(await getConfig(db, "cron_interval_hours", "0"));
        const mins = parseInt(await getConfig(db, "cron_interval_minutes", "15"));
        const intervalMs = (hours * 3600 + mins * 60) * 1000;
        
        if (now - lastTime < intervalMs) {
            console.log(`[Cron Skip] Interval not reached. Last: ${new Date(lastTime).toISOString()}`);
            return c.json({ 
                status: "skipped", 
                message: "间隔时间未到，自动探索任务跳过（可使用 force=true 强制运行）", 
                last_trigger: new Date(lastTime).toISOString(),
                next_allowable: new Date(lastTime + intervalMs).toISOString()
            });
        }
    }

    const { targetName, isEmpty } = await pickTarget(db);
    
    if (isEmpty || !targetName) {
        // Even if we don't start a task because no target, we should still update last trigger if we want to honor the "gap"
        // But usually we only update if a task is actually launched.
        return c.json({ status: "no target found", isEmpty, message: "成功收到消息，但已无更多人物可探索" });
    }

    // Update last trigger time
    await setConfig(db, "last_cron_trigger_time", String(now));

    // Set initial state
    const newTaskId = Date.now();
    const initialState = {
        status: 'running', 
        target: targetName, 
        taskId: newTaskId,
        logs: [{ timestamp: new Date().toLocaleTimeString(), msg: "系统周期性巡检：触发自动档案补完协议", type: "info" }], 
        steps: [{ msg: "周期性检索启动中...", status: "pending", startTime: Date.now() }], 
        path: null, 
        error: null, 
        newArrivals: [],
        lastHeartbeat: Date.now()
    };
    const stateStr = JSON.stringify(initialState);
    await setConfig(db, "explore_state", stateStr);

    // Trigger task in background
    const task = runExplorationTask(
        db, targetName, callAI, getConfig, setConfig, addRelationship, 
        ARCHIVE_PROMPT, ARCHIVE_SCHEMA, fetchMetadataFromWiki, c, true,
        async (msg) => { console.log(`[Cron Explore Pulse] ${msg}`); },
        newTaskId
    );
    
    if (c.executionCtx && c.executionCtx.waitUntil) {
        c.executionCtx.waitUntil(task.catch(e => console.error("[Cron Task Error]", e)));
    } else {
        // Fallback for Node.js environments
        task.catch(e => console.error("[Cron Task Error]", e));
    }
    
    console.log(`[Cron] Started task for ${targetName}`);

    return c.json({ 
        status: "success", 
        message: "后台明确确认：已成功收到 worker 触发的消息并启动背景任务", 
        target: targetName 
    });
});
