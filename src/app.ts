import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { GoogleGenAI } from "@google/genai";
import { D1DatabaseAdapter, DatabaseAdapter } from "./db.ts";
import { CATEGORIES, FIGURE_POOL } from "./figuresPool.ts";
import { EXPAND_CONNECTIONS_PROMPT, EXPAND_CONNECTIONS_SCHEMA } from "./services/aiService.ts";
import { initExplorationState, doFinalizeInsert } from "./exploreStep.ts";
import { sify } from "chinese-conv";

const root = new Hono<{ 
  Bindings: { 
    DB?: any;
    IMAGES?: any;
    GEMINI_API_KEY?: string;
    GEMINI_MODEL_ID?: string;
    ADMIN_PASSWORD?: string;
    CRON_SECRET?: string;
  },
  Variables: { dbAdapter: DatabaseAdapter } 
}>();

export const app = root.basePath('/api');

app.use('*', async (c, next) => {
  const path = c.req.path;
  const db = await getDb(c);
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || '';

  // Skip static assets and internal calls to keep logs relevant
  if (path.includes('/portraits/') || path.includes('/internal/') || path.includes('/health')) {
    return await next();
  }

  const ua = c.req.header('user-agent') || '';
  const device = /mobile|android|iphone|ipad/i.test(ua) ? 'Mobile' : 'Desktop';
  
  // Cloudflare specific geolocation
  const cf = (c.req.raw as any).cf;
  const city = cf?.city || '未知';
  const country = cf?.country || '未知';
  
  // Async log (non-blocking)
  const logPromise = db.prepare("INSERT INTO visitor_logs (ip, ua, device, city, country, path) VALUES (?, ?, ?, ?, ?, ?)")
    .run(ip, ua, device, city, country, path)
    .catch(() => {});
    
  try {
    const ctx = (c as any).executionCtx;
    if (ctx?.waitUntil) {
      ctx.waitUntil(logPromise);
    }
  } catch (e) {
    // Non-Cloudflare environment, logPromise runs in background
  }
    
  await next();
});

app.onError((err, c) => {
  console.error("Hono error:", err);
  const errorPayload: any = {
    error: err.message || String(err) || "Internal Server Error",
    stack: err.stack || "No stack trace available",
    raw_error: String(err)
  };
  if (err.cause) {
    errorPayload.cause = String(err.cause);
  }
  return c.json(errorPayload, 500);
});

app.notFound((c) => {
  console.warn(`Hono 404: ${c.req.method} ${c.req.url}`);
  return c.json({ error: "Not Found", path: c.req.path, method: c.req.method }, 404);
});

// Global for Node fallback
let nodeDbInstance: DatabaseAdapter | null = null;
let dbInitialized = false;
let initPromise: Promise<void> | null = null;

async function runBackgroundAlignment(db: DatabaseAdapter) {
  let stats = { newlyAlignedPeople: 0, newlyAlignedPool: 0, remainPeople: 0, remainPool: 0, totalPeople: 0, alignedPeople: 0 };
  try {
    console.log("[Wikidata Sync] Starting background Wikidata alignment...");
    
    let totalFetches = 0;
    const MAX_FETCHES = 25;

    // 1. Resolve for people who don't have wikidata_id yet
    const lastPersonId = parseInt(await getConfig(db, "wikidata_last_person_id", "0"), 10);
    let unalignedPeople = await db.prepare("SELECT id, name FROM people WHERE id > ? AND wikidata_id IS NULL ORDER BY id ASC LIMIT 25").all(lastPersonId) as any[];
    
    let maxPersonId = lastPersonId;
    if (unalignedPeople.length === 0 && lastPersonId > 0) {
      console.log(`[Wikidata Sync] Loop-around: reached end (lastPersonId=${lastPersonId}), resetting to start`);
      unalignedPeople = await db.prepare("SELECT id, name FROM people WHERE id > 0 AND wikidata_id IS NULL ORDER BY id ASC LIMIT 25").all() as any[];
      maxPersonId = 0;
    }

    for (const p of unalignedPeople) {
      if (totalFetches >= MAX_FETCHES) break;
      totalFetches++;
      
      if (p.id > maxPersonId) {
        maxPersonId = p.id;
      }

      const wid = await resolveWikidataId(p.name);
      if (wid) {
        await db.prepare("UPDATE people SET wikidata_id = ? WHERE id = ?").run(wid, p.id);
        stats.newlyAlignedPeople++;
        console.log(`[Wikidata Sync] Resolved person "${p.name}" to Wikidata ID: ${wid}`);
      }
      // Small delay of 100ms to be extremely polite to API
      await new Promise(r => setTimeout(r, 100));
    }

    if (maxPersonId !== lastPersonId) {
      await setConfig(db, "wikidata_last_person_id", String(maxPersonId));
      console.log(`[Wikidata Sync] Updated last aligned person ID pointer from ${lastPersonId} to ${maxPersonId}`);
    } else if (unalignedPeople.length === 0) {
      await setConfig(db, "wikidata_last_person_id", "0");
    }

    // 2. Resolve for presets who don't have wikidata_id yet
    const lastPresetName = await getConfig(db, "wikidata_last_preset_name", "");
    let unalignedPresets = await db.prepare("SELECT preset_name FROM figure_pool_sync WHERE preset_name > ? AND wikidata_id IS NULL ORDER BY preset_name ASC LIMIT 25").all(lastPresetName) as any[];
    
    let maxPresetName = lastPresetName;
    if (unalignedPresets.length === 0 && lastPresetName !== "") {
      console.log(`[Wikidata Sync] Loop-around presets: reached end (lastPresetName="${lastPresetName}"), resetting to start`);
      unalignedPresets = await db.prepare("SELECT preset_name FROM figure_pool_sync WHERE preset_name > '' AND wikidata_id IS NULL ORDER BY preset_name ASC LIMIT 25").all() as any[];
      maxPresetName = "";
    }

    for (const pr of unalignedPresets) {
      if (totalFetches >= MAX_FETCHES) break;
      totalFetches++;

      if (pr.preset_name > maxPresetName) {
        maxPresetName = pr.preset_name;
      }

      const wid = await resolveWikidataId(pr.preset_name);
      if (wid) {
        await db.prepare("UPDATE figure_pool_sync SET wikidata_id = ? WHERE preset_name = ?").run(wid, pr.preset_name);
        stats.newlyAlignedPool++;
        console.log(`[Wikidata Sync] Resolved preset "${pr.preset_name}" to Wikidata ID: ${wid}`);
      }
      // Small delay of 100ms to be extremely polite to API
      await new Promise(r => setTimeout(r, 100));
    }

    if (maxPresetName !== lastPresetName) {
      await setConfig(db, "wikidata_last_preset_name", maxPresetName);
      console.log(`[Wikidata Sync] Updated last aligned preset name pointer from "${lastPresetName}" to "${maxPresetName}"`);
    } else if (unalignedPresets.length === 0) {
      await setConfig(db, "wikidata_last_preset_name", "");
    }

    // 3. Link them by Wikidata ID or direct name matches
    await db.prepare(`
      UPDATE figure_pool_sync
      SET is_archived = 1,
          archived_person_id = (
            SELECT id FROM people 
            WHERE (people.wikidata_id = figure_pool_sync.wikidata_id AND people.wikidata_id IS NOT NULL)
               OR LOWER(people.name) = LOWER(figure_pool_sync.preset_name)
            LIMIT 1
          ),
          archived_name = (
            SELECT name FROM people 
            WHERE (people.wikidata_id = figure_pool_sync.wikidata_id AND people.wikidata_id IS NOT NULL)
               OR LOWER(people.name) = LOWER(figure_pool_sync.preset_name)
            LIMIT 1
          ),
          updated_at = CURRENT_TIMESTAMP
      WHERE is_archived = 0
        AND EXISTS (
          SELECT 1 FROM people 
          WHERE (people.wikidata_id = figure_pool_sync.wikidata_id AND people.wikidata_id IS NOT NULL)
             OR LOWER(people.name) = LOWER(figure_pool_sync.preset_name)
        )
    `).run();

    // 4. Fallback matching: If still is_archived = 0 and Wikidata ID search failed or didn't yield a match, let's run our robust name matcher!
    const unarchivedPresets = await db.prepare("SELECT preset_name FROM figure_pool_sync WHERE is_archived = 0").all() as any[];
    if (unarchivedPresets.length > 0) {
      const allPeople = await db.prepare("SELECT id, name FROM people").all() as any[];
      const matchPresetWithPeople = (pName: string): any | null => {
        const pNameLower = pName.toLowerCase();
        const synonyms: Record<string, string[]> = {
          "居里夫人": ["居里", "curie", "玛丽"],
        };

        for (const aPerson of allPeople) {
          const aName = aPerson.name.trim().toLowerCase();
          if (aName === pNameLower) return aPerson;
          
          if ((aName.includes(pNameLower) || pNameLower.includes(aName)) && (aName.length >= 2 && pNameLower.length >= 2)) return aPerson;
          
          const partsA = aName.split('·');
          const lastPartA = partsA[partsA.length - 1];
          const partsP = pNameLower.split('·');
          const lastPartP = partsP[partsP.length - 1];
          if (lastPartA && lastPartP && lastPartA.length >= 2 && lastPartP.length >= 2) {
            if (lastPartA === lastPartP) return aPerson;
          }

          if (synonyms[pName]) {
            if (synonyms[pName].some(syn => aName.includes(syn))) return aPerson;
          }
        }
        return null;
      };

      for (const presetRow of unarchivedPresets) {
        const matchedPerson = matchPresetWithPeople(presetRow.preset_name);
        if (matchedPerson) {
          await db.prepare("UPDATE figure_pool_sync SET is_archived = 1, archived_person_id = ?, archived_name = ?, updated_at = CURRENT_TIMESTAMP WHERE preset_name = ?")
            .run(matchedPerson.id, matchedPerson.name, presetRow.preset_name);
          console.log(`[Wikidata Sync Fallback] Linked preset "${presetRow.preset_name}" to archive "${matchedPerson.name}" (ID: ${matchedPerson.id})`);
        }
      }
    }

    const remainPeopleRes = await db.prepare("SELECT COUNT(*) as count FROM people WHERE wikidata_id IS NULL").get() as any;
    const remainPoolRes = await db.prepare("SELECT COUNT(*) as count FROM figure_pool_sync WHERE wikidata_id IS NULL").get() as any;
    stats.remainPeople = remainPeopleRes?.count || 0;
    stats.remainPool = remainPoolRes?.count || 0;

    const totalPeopleRes = await db.prepare("SELECT COUNT(*) as count FROM people").get() as any;
    const alignedPeopleRes = await db.prepare("SELECT COUNT(*) as count FROM people WHERE wikidata_id IS NOT NULL").get() as any;
    stats.totalPeople = totalPeopleRes?.count || 0;
    stats.alignedPeople = alignedPeopleRes?.count || 0;

    console.log(`[Wikidata Sync] Background alignment complete.`);
  } catch (err) {
    console.error("[Wikidata Sync] Error in background alignment:", err);
  }
  return stats;
}

export async function getDb(c: any): Promise<DatabaseAdapter> {
  let db: DatabaseAdapter;
  if (c.env && c.env.DB_ADAPTER) {
    db = c.env.DB_ADAPTER;
  } else if (c.env && c.env.DB) {
    db = new D1DatabaseAdapter(c.env.DB);
  } else {
    throw new Error(`No database adapter provided. Ensure D1 is bound as 'DB'. Environment keys available: ${c.env ? Object.keys(c.env).join(', ') : 'none'}`);
  }
  
  if (!dbInitialized) {
    if (!initPromise) {
      initPromise = (async () => {
        let skipSetup = false;
        try {
          const row = await db.prepare("SELECT value FROM config WHERE key = ?").get("init_done_v2") as any;
          if (row && row.value === "true") {
            skipSetup = true;
          }
        } catch (e) {
          // Table or key does not exist yet, defaulting to full setup
        }

        if (skipSetup) {
          // Even if setup has been done previously, ensure all newer columns and tables exist (robust migration)
          try {
            await db.prepare("ALTER TABLE people ADD COLUMN wikidata_id TEXT").run();
          } catch (e) {}
          try {
            await db.prepare(`CREATE TABLE IF NOT EXISTS figure_pool_sync (
              preset_name TEXT PRIMARY KEY,
              is_archived INTEGER DEFAULT 0,
              archived_person_id INTEGER,
              archived_name TEXT,
              wikidata_id TEXT,
              updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`).run();
          } catch (e) {}
          try {
            await db.prepare("CREATE INDEX IF NOT EXISTS idx_people_wikidata_id ON people(wikidata_id)").run();
          } catch (e) {}
          try {
            await db.prepare("CREATE INDEX IF NOT EXISTS idx_figure_pool_sync_wikidata_id ON figure_pool_sync(wikidata_id)").run();
          } catch (e) {}
          try {
            await db.prepare("CREATE INDEX IF NOT EXISTS idx_figure_pool_sync_is_archived ON figure_pool_sync(is_archived)").run();
          } catch (e) {}

          // Seed missing preset figures if table is empty
          try {
            const countRow = await db.prepare("SELECT COUNT(*) as count FROM figure_pool_sync").get() as any;
            if (!countRow || countRow.count === 0) {
              const flatPool = Object.values(FIGURE_POOL).flat();
              for (const name of flatPool) {
                try {
                  await db.prepare("INSERT OR IGNORE INTO figure_pool_sync (preset_name) VALUES (?)").run(name);
                } catch (pe) {}
              }
              console.log(`[Database Seed skipSetup] Seeded ${flatPool.length} presets.`);
            }
          } catch (err) {
            console.error("[Database Seed skipSetup] Failed to seed:", err);
          }

          dbInitialized = true;
          return;
        }

        const tableQueries = [
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
            wikidata_id TEXT,
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
          `CREATE TABLE IF NOT EXISTS task_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT,
            type TEXT,
            msg TEXT,
            data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS explore_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_name TEXT NOT NULL,
            priority INTEGER DEFAULT 0,
            status TEXT DEFAULT 'pending',
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
          )`,
          `CREATE TABLE IF NOT EXISTS visitor_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT,
            ua TEXT,
            device TEXT,
            city TEXT,
            country TEXT,
            path TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            ip TEXT,
            city TEXT,
            country TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS banned_ips (
            ip TEXT PRIMARY KEY,
            reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          `CREATE TABLE IF NOT EXISTS figure_pool_sync (
            preset_name TEXT PRIMARY KEY,
            is_archived INTEGER DEFAULT 0,
            archived_person_id INTEGER,
            archived_name TEXT,
            wikidata_id TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`
        ];
        for (const q of tableQueries) {
          await db.prepare(q).run();
        }

        const migrations = [
          "ALTER TABLE people ADD COLUMN latitude REAL DEFAULT 0",
          "ALTER TABLE people ADD COLUMN longitude REAL DEFAULT 0",
          "ALTER TABLE people ADD COLUMN image_url TEXT",
          "ALTER TABLE people ADD COLUMN lifespan TEXT",
          "ALTER TABLE people ADD COLUMN birthplace TEXT",
          "ALTER TABLE people ADD COLUMN wikidata_id TEXT"
        ];
        for (const m of migrations) {
          try {
            await db.prepare(m).run();
          } catch (e) {
            // Suppress error if column already exists
          }
        }

        const indexQueries = [
          "CREATE INDEX IF NOT EXISTS idx_relationships_person2 ON relationships(person2_id)",
          "CREATE INDEX IF NOT EXISTS idx_figure_pool_sync_is_archived ON figure_pool_sync(is_archived)",
          "CREATE INDEX IF NOT EXISTS idx_people_wikidata_id ON people(wikidata_id)",
          "CREATE INDEX IF NOT EXISTS idx_figure_pool_sync_wikidata_id ON figure_pool_sync(wikidata_id)"
        ];
        for (const q of indexQueries) {
          try {
            await db.prepare(q).run();
          } catch (e) {
            // Ignore index setup failures
          }
        }

        // Seed missing preset figures if table is empty
        try {
          const countRow = await db.prepare("SELECT COUNT(*) as count FROM figure_pool_sync").get() as any;
          if (!countRow || countRow.count === 0) {
            const flatPool = Object.values(FIGURE_POOL).flat();
            for (const name of flatPool) {
              try {
                await db.prepare("INSERT OR IGNORE INTO figure_pool_sync (preset_name) VALUES (?)").run(name);
              } catch (pe) {}
            }
            console.log(`[Database Seed fullSetup] Seeded ${flatPool.length} presets.`);
          }
        } catch (err) {
          console.error("[Database Seed fullSetup] Failed to seed:", err);
        }
        
        // Mark database initialization as completed to bypass on future cold starts
        try {
          await db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('init_done_v2', 'true')").run();
        } catch (confErr) {
          console.error("Failed to set init_done_v2:", confErr);
        }

        dbInitialized = true;
      })();
    }
    await initPromise;
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
    return (c.env && c.env.ADMIN_PASSWORD) || (typeof process !== "undefined" && process.env ? process.env.ADMIN_PASSWORD : "") || "admin";
};

export async function callAI(c: any, db: DatabaseAdapter, prompt: string, responseFormat: "text" | "json" = "text", schema?: any): Promise<string> {
  const provider = await getConfig(db, "active_model_provider", "gemini");
  
  let apiKey = "";  
  if (provider === "aliyun") {
      apiKey = await getConfig(db, "aliyun_api_key");
  } else {
      apiKey = (await getConfig(db, "gemini_api_key")) || (c.env && c.env.GEMINI_API_KEY) || (typeof process !== "undefined" && process.env ? process.env.GEMINI_API_KEY : "") || "";
  }
  
  const cleanup = () => {
      // isFetching = false;
  };
  
  if (provider === "aliyun") {
    const modelId = await getConfig(db, "aliyun_model_id");
    if (!apiKey) { cleanup(); throw new Error("缺少 Aliyun API Key"); }
    if (!modelId) { cleanup(); throw new Error("缺少 Aliyun 模型 ID"); }
    
    const systemContent = `你是一个历史学和百科知识专家。当被要求返回 JSON 时，请严格遵守指定的 schema，且只返回 JSON 原始内容。不要包含任何 Markdown 格式。`;

    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`[Aliyun] Request timeout reached (290s) for prompt: ${prompt.substring(0, 50)}...`);
        controller.abort();
    }, 290000); 

    const aliyunCleanup = () => {
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
    // apiKey is already retrieved at the top
    const modelId = (await getConfig(db, "gemini_model_id")) || (c.env && c.env.GEMINI_MODEL_ID) || (typeof process !== "undefined" && process.env ? process.env.GEMINI_MODEL_ID : "") || "gemini-1.5-flash";
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

export async function resolveWikidataId(name: string): Promise<string | null> {
  const headers = { "User-Agent": "HistoricalArchiveApp/1.0 (zhiduanchangyu@gmail.com)" };
  try {
    const searchRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=zh&format=json`, { headers });
    const searchData = await searchRes.json() as any;
    const entity = searchData.search?.[0];
    if (entity) return entity.id;
  } catch (e) {
    console.error(`[Wiki API] resolveWikidataId failed for ${name}:`, e);
  }
  return null;
}

export async function fetchMetadataFromWiki(name: string) {
  const headers = { "User-Agent": "HistoricalArchiveApp/1.0 (zhiduanchangyu@gmail.com)" };
  try {
    console.log(`[Wiki API] Searching Wikidata for: ${name}`);
    const searchRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=zh&format=json`, { headers });
    const searchData = await searchRes.json() as any;
    const entity = searchData.search?.[0];
    
    if (entity) {
      console.log(`[Wiki API] Found Wikidata entity: ${entity.id} - ${entity.label}`);
      const entityId = entity.id;
      const entityRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entityId}&props=claims|descriptions|labels&languages=zh|en&format=json`, { headers });
      const entityData = await entityRes.json() as any;
      const item = entityData.entities[entityId];
      
      const zhLabel = item.labels?.zh?.value;
      const description = item.descriptions?.zh?.value || item.descriptions?.en?.value || entity.description || "";
      console.log(`[Wiki API] Parsed description: ${description.substring(0, 50)}...`);
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
        imageUrl: imageUrl || null,
        wikidataId: entityId || null
      };
    }
    
    // Fallback to Wikipedia search for snippet if Wikidata yields nothing
    console.log(`[Wiki API] No Wikidata entity found for ${name}, falling back to Wikipedia search`);
    const wikiRes = await fetch(`https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json`, { headers });
    const wikiData = await wikiRes.json() as any;
    const wikiItem = wikiData.query?.search?.[0];
    if (wikiItem) {
        let snippet = (wikiItem.snippet || "").replace(/<[^>]*>?/gm, '');
        console.log(`[Wiki API] Found Wikipedia snippet: ${snippet.substring(0, 50)}...`);
        return {
            normalizedName: wikiItem.title,
            description: snippet,
            imageUrl: null,
            wikidataId: null
        };
    }

    console.log(`[Wiki API] Nothing found for ${name}`);
    return { normalizedName: name, description: "", imageUrl: null, wikidataId: null };
  } catch (e) {
    console.error("Wiki/Wikidata fetch error:", e);
    return { normalizedName: name, description: "", imageUrl: null, wikidataId: null };
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

app.get("/sitemap.xml", async (c) => {
  const db = await getDb(c);
  // Get main URL from request
  const urlObj = new URL(c.req.url);
  const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
  
  // Just creating a basic index sitemap to help index the entry point
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <!-- As this is an SPA, the main discovery happens at / -->
</urlset>`;

  return c.text(sitemap, 200, {
    "Content-Type": "application/xml",
    "Cache-Control": "public, max-age=86400"
  });
});

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
    auto_refill_enabled: await getConfig(db, "auto_refill_enabled", "false") === "true"
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
  if (body.auto_refill_enabled !== undefined) await setConfig(db, "auto_refill_enabled", String(body.auto_refill_enabled));
  
  return c.json({ success: true });
});

app.get("/admin/people", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const people = await db.prepare("SELECT id, name, category, created_at FROM people ORDER BY created_at DESC").all();
  return c.json(people);
});

app.get("/feedback", async (c) => {
  const db = await getDb(c);
  const feedback = await db.prepare("SELECT id, content, city, country, ip, created_at FROM feedback ORDER BY created_at DESC LIMIT 100").all();
  return c.json(feedback);
});

app.post("/feedback", async (c) => {
  const { content } = await c.req.json();
  if (!content || content.trim().length < 2) return c.json({ error: "内容太短了" }, 400);
  
  const db = await getDb(c);
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || '';

  if (ip) {
    const isBanned = await db.prepare("SELECT 1 FROM banned_ips WHERE ip = ?").get(ip);
    if (isBanned) {
      return c.json({ error: "您已被禁止提交评论" }, 403);
    }
  }
  
  // Rate limit check: max 2 feedbacks per day per IP
  const countRes = await db.prepare("SELECT COUNT(*) as count FROM feedback WHERE ip = ? AND created_at > datetime('now', '-1 day')").get(ip) as any;
  if (countRes?.count >= 2) return c.json({ error: "每人每天限发2条，请明天再来吧" }, 429);

  const cf = (c.req.raw as any).cf;
  const city = cf?.city || '未知';
  const country = cf?.country || '未知';

  await db.prepare("INSERT INTO feedback (content, ip, city, country) VALUES (?, ?, ?, ?)").run(content.trim(), ip, city, country);
  return c.json({ success: true });
});

app.get("/admin/feedback", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const feedback = await db.prepare("SELECT * FROM feedback ORDER BY created_at DESC").all();
  return c.json(feedback);
});

app.post("/admin/feedback/batch-delete", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const { ids } = await c.req.json();
  const db = await getDb(c);
  if (Array.isArray(ids) && ids.length > 0) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      await db.prepare(`DELETE FROM feedback WHERE id IN (${placeholders})`).run(...chunk);
    }
  }
  return c.json({ success: true });
});

app.get("/admin/bans", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const bans = await db.prepare("SELECT * FROM banned_ips ORDER BY created_at DESC").all();
  return c.json(bans);
});

app.post("/admin/bans", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const { ip, reason } = await c.req.json();
  const db = await getDb(c);
  await db.prepare("INSERT OR REPLACE INTO banned_ips (ip, reason) VALUES (?, ?)").run(ip, reason);
  return c.json({ success: true });
});

app.delete("/admin/bans/:ip", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const ip = c.req.param("ip");
  const db = await getDb(c);
  await db.prepare("DELETE FROM banned_ips WHERE ip = ?").run(ip);
  return c.json({ success: true });
});

app.get("/admin/visitor-stats", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  
  // 1, 2, 3: Optimize DB queries by running them concurrently
  const [totalRes, deviceRes, regionRes] = await Promise.all([
    db.prepare("SELECT COUNT(*) as count FROM (SELECT ip, ua, strftime('%Y-%m-%d %H', timestamp) FROM visitor_logs GROUP BY ip, ua, strftime('%Y-%m-%d %H', timestamp))").get() as any,
    db.prepare("SELECT device, COUNT(*) as count FROM (SELECT device, ip, ua, strftime('%Y-%m-%d %H', timestamp) FROM visitor_logs GROUP BY device, ip, ua, strftime('%Y-%m-%d %H', timestamp)) GROUP BY device").all() as any,
    db.prepare(`
      SELECT 
        CASE WHEN city != '未知' THEN city ELSE country END as region,
        COUNT(*) as count 
      FROM (
        SELECT city, country, ip, ua, strftime('%Y-%m-%d %H', timestamp) 
        FROM visitor_logs 
        GROUP BY city, country, ip, ua, strftime('%Y-%m-%d %H', timestamp)
      ) 
      GROUP BY region 
      ORDER BY count DESC 
      LIMIT 10
    `).all() as any
  ]);

  const totalVisits = totalRes?.count || 0;

  const deviceStats = {
    Mobile: (deviceRes as any[]).find((r: any) => r.device === 'Mobile')?.count || 0,
    Desktop: (deviceRes as any[]).find((r: any) => r.device === 'Desktop')?.count || 0,
  };

  return c.json({
    totalVisits,
    deviceStats,
    regions: regionRes || []
  });
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
  if (person) {
    await db.prepare("DELETE FROM explore_queue WHERE target_name = ? COLLATE NOCASE").run(person.name);
  }
  await db.prepare("DELETE FROM people WHERE id = ?").run(id);
  return c.json({ success: true });
});

app.post("/admin/people/batch-delete", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const { ids } = await c.req.json();
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "No ids provided" }, 400);

  const CHUNK_SIZE = 50;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    
    // Get people names for R2 deletion
    const people = await db.prepare(`SELECT name FROM people WHERE id IN (${placeholders})`).all(...chunk) as any[];
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

    await db.prepare(`DELETE FROM relationships WHERE person1_id IN (${placeholders}) OR person2_id IN (${placeholders})`).run(...chunk, ...chunk);
    if (people.length > 0) {
      const names = people.map(p => p.name);
      const namePlaceholders = names.map(() => "?").join(",");
      await db.prepare(`DELETE FROM explore_queue WHERE target_name IN (${namePlaceholders}) COLLATE NOCASE`).run(...names);
    }
    await db.prepare(`DELETE FROM people WHERE id IN (${placeholders})`).run(...chunk);
  }

  return c.json({ success: true });
});

app.post("/admin/people/:id/expand-connections", async (c) => {
  if (c.req.header("x-admin-password") !== getAdminPassword(c)) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const id = c.req.param("id");
  
  return streamSSE(c, async (stream) => {
    const send = async (data: any) => await stream.writeSSE({ data: JSON.stringify(data) });
    
    try {
      // 1. Get current person info
      const person = await db.prepare("SELECT * FROM people WHERE id = ?").get(id) as any;
      if (!person) {
          await send({ type: 'error', msg: "人物不存在" });
          return;
      }

      await send({ type: 'step', msg: `初始化 [${person.name}] 的时空扩展任务...` });

      // 2. Get candidates
      await send({ type: 'info', msg: "正在扫描馆藏档案库以匹配潜在连接点..." });
      // Pick 50 random people excluding the current person and those already connected
      const candidates = await db.prepare(`
        SELECT name FROM people 
        WHERE id != ?
        AND id NOT IN (
          SELECT person1_id FROM relationships WHERE person2_id = ?
          UNION
          SELECT person2_id FROM relationships WHERE person1_id = ?
        )
        ORDER BY RANDOM() LIMIT 50
      `).all(id, id, id) as any[];
      
      let addedCount = 0;

      if (candidates.length > 0) {
          await send({ type: 'ai-req', msg: `已选取 ${candidates.length} 名潜在对象，请求 AI 进行维度对齐...` });
          const prompt = EXPAND_CONNECTIONS_PROMPT(person.name, person.biography, candidates.map(c => c.name));
          
          const resultText = await callAI(c, db, prompt, "json", EXPAND_CONNECTIONS_SCHEMA);
          
          await send({ type: 'ai-res', msg: "AI 计算完成，正在建立连接隧道..." });
          let newRels: any[] = [];
          try {
              const sanitizedText = (resultText || "[]")
                  .replace(/\n/g, ' ')
                  .replace(/\r/g, '')
                  .replace(/\t/g, ' ');
              newRels = JSON.parse(sanitizedText);
          } catch (e) {
              console.error("Expand connections parse failed", e, "\nText:", resultText);
              await send({ type: 'error', msg: `AI 数据解析异常，请重试。` });
              return;
          }
          
          for (const rel of newRels) {
              const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
              if (matched) {
                  await addRelationship(db, parseInt(id), matched.id, rel.relationshipType);
                  addedCount++;
                  await send({ type: 'info', msg: `成功建立与 [${rel.personName}] 的联系: ${rel.relationshipType}` });
              }
          }
      }

      if (addedCount > 0) {
          await send({ type: 'result', addedCount });
          return;
      }

      // 4. Fallback: pick from raw_relationships
      await send({ type: 'info', msg: "当前馆藏内未发现新联系。正在溯源原始时空轨迹..." });
      const archivedPeopleRows = await db.prepare("SELECT name FROM people").all() as any[];
      const archivedNames = new Set(archivedPeopleRows.map(p => p.name));
      
      let rawRels = [];
      try { rawRels = JSON.parse(person.raw_relationships || "[]"); } catch (e) {}

      const unarchivedCandidates = rawRels
          .map((r: any) => r.personName)
          .filter((name: string) => name && !archivedNames.has(name));

      if (unarchivedCandidates.length > 0) {
          await send({ type: 'info', msg: `发现 ${unarchivedCandidates.length} 名库外关联人物。正在由 AI 评估优先收录目标...` });
          const fallbackPrompt = `你是一位历史策展人。人物 "${person.name}" 的原始关联中有一些尚未正式入库的历史人物：[${unarchivedCandidates.join("、")}]。\n请从中挑选出一名您认为最重要/最知名/最值得入库的人物，并给出推荐理由。\n\n请严格返回以下格式的 JSON：\n{ "name": "标准中文译名", "reason": "推荐收录理由(20字内)" }`;
          
          const pickedRaw = await callAI(c, db, fallbackPrompt, "json", {
              type: "object",
              properties: {
                  name: { type: "string" },
                  reason: { type: "string" }
              },
              required: ["name", "reason"]
          });
          
          let picked: any = {};
          try {
              const sanitizedRaw = (pickedRaw || "{}")
                  .replace(/\n/g, ' ')
                  .replace(/\r/g, '')
                  .replace(/\t/g, ' ');
              picked = JSON.parse(sanitizedRaw);
          } catch(e) {
              console.error("Fallback json parse failed", e);
          }
          if (picked.name && unarchivedCandidates.includes(picked.name)) {
              await send({ type: 'result', addedCount: 0, fallbackArchive: picked });
              return;
          }
      }

      await send({ type: 'info', msg: "全维度检索完毕，未发现可收录的新目标。" });
      await send({ type: 'result', addedCount: 0 });
      
    } catch (e: any) {
        await send({ type: 'error', msg: e.message });
    }
  });
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
  const page = parseInt(c.req.query("page") || "0");
  const limit = parseInt(c.req.query("limit") || "0");
  const search = c.req.query("search") || "";
  
  let peopleQuery = `
    SELECT p.*, 
    (SELECT COUNT(*) FROM relationships WHERE person1_id = p.id OR person2_id = p.id) as connectionsCount
    FROM people p
  `;
  
  const params: any[] = [];
  if (search) {
    peopleQuery += ` WHERE p.name LIKE ? OR p.category LIKE ? `;
    const s = `%${search}%`;
    params.push(s, s);
  }
  
  peopleQuery += ` ORDER BY created_at DESC `;
  
  if (limit > 0) {
    peopleQuery += ` LIMIT ? OFFSET ? `;
    params.push(limit, (page > 0 ? page - 1 : 0) * limit);
  }

  let people = await db.prepare(peopleQuery).all(...params) as any[];
  const relationships = await db.prepare("SELECT * FROM relationships").all();
  
  // Also get total count if paginated
  let total = people.length;
  if (limit > 0) {
    let countQuery = "SELECT COUNT(*) as count FROM people";
    const countParams: any[] = [];
    if (search) {
      countQuery += " WHERE name LIKE ? OR category LIKE ? OR biography LIKE ? ";
      const s = `%${search}%`;
      countParams.push(s, s, s);
    }
    const countRes = await db.prepare(countQuery).get(...countParams) as any;
    total = countRes?.count || 0;
  }

  people = people.map(p => ({
    ...p,
    image_url: `/api/portraits/${encodeURIComponent(p.name.toLowerCase())}.jpg`
  }));

  return c.json({ people, relationships, total, page, limit });
});

app.get("/metadata", async (c) => {
  const db = await getDb(c);
  const existingPeopleNames = (await db.prepare("SELECT name FROM people").all() as any[]).map(p => p.name).join("、");
  return c.json({
      categories: CATEGORIES,
      existingNames: existingPeopleNames,
      activeProvider: await getConfig(db, "active_model_provider", "gemini"),
      geminiModelId: await getConfig(db, "gemini_model_id"),
      geminiApiKey: !!((await getConfig(db, "gemini_api_key")) || (c.env && c.env.GEMINI_API_KEY) || (typeof process !== "undefined" && process.env ? process.env.GEMINI_API_KEY : "")),
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
  let { name, data } = await c.req.json();
  if (!name) return c.json({ error: "Missing name" }, 400);
  name = sify(name.trim());
  if (data && data.relationships && Array.isArray(data.relationships)) {
    data.relationships = data.relationships.map((rel: any) => ({
      ...rel,
      personName: sify((rel.personName || "").trim())
    }));
  }

  let wikidataId: string | null = null;
  try {
    wikidataId = await resolveWikidataId(name);
  } catch (e) {}

  let existing = await db.prepare("SELECT id, biography, name FROM people WHERE name = ?").get(name) as any;
  if (!existing && wikidataId) {
    const matchedByWiki = await db.prepare("SELECT id, biography, name FROM people WHERE wikidata_id = ?").get(wikidataId) as any;
    if (matchedByWiki) {
      existing = matchedByWiki;
      name = matchedByWiki.name; // Use standard/existing name to redirect updating logic and prevent duplicates
    }
  }
  const isFull = existing && existing.biography !== "正在同步资料...";

  if (!data) {
    if (existing) return c.json({ id: existing.id, isNew: false, isFull });
    return c.json({ id: null, isNew: true, isFull: false });
  }

  try {
    const portraitUrl = await getPortraitUrl(c, name);
    const stmt = db.prepare(`
      INSERT INTO people (name, category, keyword, lifespan, birthplace, biography, achievements, image_url, raw_relationships, wikidata_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET 
        category=excluded.category, keyword=excluded.keyword, lifespan=excluded.lifespan, birthplace=excluded.birthplace, biography=excluded.biography, 
        achievements=excluded.achievements, image_url=excluded.image_url, raw_relationships=excluded.raw_relationships,
        wikidata_id=COALESCE(excluded.wikidata_id, people.wikidata_id)
      RETURNING id
    `);
    
    const inserted = await stmt.get(
        name, data.category || "其他", data.keyword || "", data.lifespan || "", data.birthplace || "", data.biography || "",
        JSON.stringify(data.achievements || []), portraitUrl, JSON.stringify(data.relationships || []), wikidataId
    ) as { id: number };

    // Update figure_pool_sync
    if (inserted && inserted.id) {
      if (wikidataId) {
        await db.prepare(`
          UPDATE figure_pool_sync 
          SET is_archived = 1, archived_person_id = ?, archived_name = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE (wikidata_id = ? OR LOWER(preset_name) = LOWER(?))
        `).run(inserted.id, name, wikidataId, name);
      } else {
        await db.prepare(`
          UPDATE figure_pool_sync 
          SET is_archived = 1, archived_person_id = ?, archived_name = ?, updated_at = CURRENT_TIMESTAMP 
          WHERE LOWER(preset_name) = LOWER(?)
        `).run(inserted.id, name, name);
      }
    }

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
    
    const previousMentions = await db.prepare(`
        SELECT id, name, raw_relationships 
        FROM people 
        WHERE id != ? 
          AND json_valid(raw_relationships) 
          AND EXISTS (
            SELECT 1 
            FROM json_each(people.raw_relationships) 
            WHERE LOWER(json_extract(value, '$.personName')) = LOWER(?)
          )
    `).all(inserted.id, name) as any[];
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

      const prompt = `你正在主持一场跨越时空的史诗级对话。
人物 A: ${p1Data.name}，传记: ${p1Data.biography}
人物 B: ${p2Data.name}，传记: ${p2Data.biography}

请模拟这两人之间的一场极其精彩的跨时空对话。要求如下：
1. **回合与句子限制**：两个人之间进行 2~3 个回合（来回），对话条数总共正好产生 4~6 句话。
2. **字数严格限制**：每句话的长度必须限制在 1~20 个字（汉字/字符）之间。极其简练，杜绝废话，多一个字都会被系统截断！
3. **经典气质与形象特征**：两个历史人物应极度保留其历史上的经典气质、学说口吻与性格习惯，形象特色鲜明、高辨识度，严禁千人一面。
4. **对白风格与化学反应**：对白必须兼具深邃哲思与风趣幽默，化学反应鲜明亮眼，拒绝白开水对话。
5. **强烈的情感冲击**：可以是充满犀利吐槽的超级爆笑、带着黑色幽默的超级讽刺、或是直击宿命遗憾的超级感人。必须非常接地气、抓人眼球，让普通现代观众能瞬间被吸引和代入。
6. **合规与规范**：你必须全程使用简体中文，严禁使用任何繁体字，坚决不涉及任何中国近代以来的政治敏感人物和话题。

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

export async function pickTarget(db: DatabaseAdapter) {
  const people = await db.prepare("SELECT name, raw_relationships FROM people").all() as any[];
  const archivedNamesList: string[] = people.map(p => p.name.trim().toLowerCase());
  
  // Also exclude people in queue (pending, processing, or ALREADY completed to avoid alias re-enqueuing)
  const queuedPeopleRows = await db.prepare("SELECT target_name FROM explore_queue WHERE status = 'pending' OR status = 'processing' OR status = 'completed'").all() as any[];
  queuedPeopleRows.forEach(t => archivedNamesList.push(t.target_name.trim().toLowerCase()));

  // Also exclude previously failed people from automated picking (so they do not immediately retry automatically)
  const failedPeopleRows = await db.prepare("SELECT DISTINCT LOWER(target_name) as target_name FROM explore_queue WHERE status = 'error'").all() as any[];
  failedPeopleRows.forEach((t: any) => archivedNamesList.push(t.target_name.trim().toLowerCase()));

  // Helper to matching preset name with database full names (handles middle dots & synonyms)
  const isFigInDb = (poolName: string, archivedNames: string[]): boolean => {
    const pName = poolName.trim().toLowerCase();
    
    const synonyms: Record<string, string[]> = {
      "居里夫人": ["居里", "curie", "玛丽"],
    };

    for (const aName of archivedNames) {
      if (aName === pName) return true;
      
      // If either name contains the other as substring (minimally 2 characters long to avoid fake 1-char matches)
      if (aName.includes(pName) || pName.includes(aName)) return true;
      
      // Compare the last part separated by dot (e.g., "弗朗西斯科·戈雅" -> last part "戈雅")
      const partsA = aName.split('·');
      const lastPartA = partsA[partsA.length - 1];
      const partsP = pName.split('·');
      const lastPartP = partsP[partsP.length - 1];
      if (lastPartA && lastPartP && lastPartA.length >= 2 && lastPartP.length >= 2) {
        if (lastPartA === lastPartP) return true;
      }

      if (synonyms[poolName]) {
        if (synonyms[poolName].some(syn => aName.includes(syn))) return true;
      }
    }
    return false;
  };
  
  const shuffle = (array: any[]) => {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  };
  
  // Priority 1: From pre-defined Figure Pool (Background Collection) via the database table figure_pool_sync
  const poolUnarchivedRows = await db.prepare(`
    SELECT preset_name FROM figure_pool_sync
    WHERE is_archived = 0
      AND LOWER(preset_name) NOT IN (
        SELECT LOWER(target_name) FROM explore_queue
        WHERE status IN ('pending', 'processing', 'completed', 'error')
      )
  `).all() as any[];
  const poolUnarchived = poolUnarchivedRows.map(r => r.preset_name);
  const uniquePoolUnarchived = Array.from(new Set(poolUnarchived));

  if (uniquePoolUnarchived.length >= 1) {
      const picked = shuffle([...uniquePoolUnarchived])[0];
      return { targetName: picked, strategy: "图谱预设池" };
  }

  // Priority 2: From Relationships (Secondary Nodes / Connected figures) - Pick most connected
  const connectedCounts = new Map<string, { originalName: string, count: number }>();
  people.forEach(p => {
    try {
      const rels = JSON.parse(p.raw_relationships || "[]");
      rels.forEach((r: any) => {
        if (r.personName) {
           const lowName = r.personName.trim().toLowerCase();
           if (!isFigInDb(r.personName, archivedNamesList)) {
              const existing = connectedCounts.get(lowName);
              if (existing) {
                  existing.count++;
              } else {
                  connectedCounts.set(lowName, { originalName: r.personName, count: 1 });
              }
           }
        }
      });
    } catch(e) {}
  });

  if (connectedCounts.size >= 1) {
      const candidates = Array.from(connectedCounts.values());
      candidates.sort((a, b) => b.count - a.count);
      const topCount = candidates[0].count;
      const topCandidates = candidates.filter(c => c.count === topCount);
      const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)].originalName;
      return { targetName: picked, strategy: `时空关系高阶补位 (连接数: ${topCount})` };
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
  
  // Exclude blacklisted people (wikidata photo error >= 2, or other errors >= 2)
  const failedPeopleRows = await db.prepare(`
    SELECT target_name 
    FROM explore_queue 
    WHERE status = 'error' 
    GROUP BY LOWER(target_name) 
    HAVING SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) >= 2 
       OR (COUNT(*) - SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END)) >= 2
  `).all() as any[];
  const allExcludes = [...samplePeople.map((p: any) => p.name), ...failedPeopleRows.map((p: any) => p.target_name)];
  
  const sampleNames = allExcludes.join("、");
  
  const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。
要求：
1. 不包含在以下列表中：[${sampleNames}]
2. 此人必须在 Wikidata/Wikipedia 有详尽记载。
3. 请只返回此人的标准中文译名（必须是简体中文），不带任何其他文字。
4. 禁止选取中国近代及现代政治领导人（如毛泽东等）。
5. 严禁出现繁体字。
6. 必须是已故的历史人物，严禁选取任何仍然在世的当代名人（如马斯克、比尔·盖茨等当代尚健在的人物）。`;

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
  const { personName, source: reqSource } = await c.req.json();
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
  
  if (!isAdmin && await getConfig(db, "demo_mode") === "true") {
      return c.json({ error: "只读模式，如需演示归档，请访问项目GitHub" }, 403);
  }

  // Use the enqueue logic instead of direct processing
  const targetName = sify((personName || "").trim());
  if (!targetName) return c.json({ error: "Invalid target" }, 400);
  
  // Resolve Wikidata ID immediately to search for standard spellings and avoid duplicate archival
  let wikidataId: string | null = null;
  try {
      wikidataId = await resolveWikidataId(targetName);
  } catch (e) {}

  // Check if already in people table by name or Wikidata ID
  let existingPerson = await db.prepare("SELECT id, name FROM people WHERE name = ? COLLATE NOCASE").get(targetName) as any;
  if (!existingPerson && wikidataId) {
      existingPerson = await db.prepare("SELECT id, name FROM people WHERE wikidata_id = ?").get(wikidataId) as any;
  }

  if (existingPerson) {
      return c.json({ error: `[${targetName}] 已在档案库中（以标准名称 [${existingPerson.name}] 存在），无需重复入库。`, alreadyExists: true, personId: existingPerson.id }, 400);
  }

  // Check if blacklisted
  const errStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_errors,
        SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) as photo_errors
      FROM explore_queue
      WHERE LOWER(target_name) = ? AND status = 'error'
  `).get(targetName.toLowerCase()) as { total_errors: number, photo_errors: number };

  const totalErrors = errStats?.total_errors || 0;
  const photoErrors = errStats?.photo_errors || 0;
  const otherErrors = totalErrors - photoErrors;
  if (photoErrors >= 2 || otherErrors >= 2) {
      const bReason = photoErrors >= 2 ? `Wikidata 缺少相片入库失败达 ${photoErrors} 次` : `AI调用/系统错误落库失败达 ${otherErrors} 次`;
      return c.json({ error: `[${targetName}] 已触碰时空偏航熔断规则（${bReason}），已被系统自动拦截，不可再入库。` }, 400);
  }
  
  // Check if already in queue
  const existingQueue = await db.prepare("SELECT id FROM explore_queue WHERE target_name = ? AND (status = 'pending' OR status = 'processing') COLLATE NOCASE").get(targetName) as any;
  if (existingQueue) {
      return c.json({ error: `[${targetName}] 任务已在队列中执行或等待中。`, alreadyQueued: true }, 400);
  }

  // Priority 1 for manual admin archival
  const res = await db.prepare("INSERT INTO explore_queue (target_name, priority) VALUES (?, 1) RETURNING id").get(targetName) as any;
  const taskId = res.id;
  
  await updateExplorationState(db, {
      status: "running",
      subStatus: "queued",
      target: targetName,
      taskId: taskId,
      source: reqSource || 'list',
      error: null
  }, { msg: `管理员发起入库请求: ${targetName} (已加入集群队列)`, type: "api" });
  
  return c.json({ success: true, taskId, targetName });
});

app.post("/save-relationship", async (c) => {
  const db = await getDb(c);
  let { sourceName, targetName, relationshipType } = await c.req.json();
  if (!sourceName || !targetName || !relationshipType) return c.json({ error: "Missing info" }, 400);

  sourceName = sify(sourceName.trim());
  targetName = sify(targetName.trim());

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

// Helper to update global exploration state with logs
async function updateExplorationState(db: DatabaseAdapter, updates: any, newLog?: { msg: string, type: string, data?: any, source?: string }) {
    let currentStr = await getConfig(db, "explore_state", "null");
    let state: any = currentStr === "null" ? { status: 'idle', logs: [], steps: [] } : JSON.parse(currentStr);
    
    // Merge updates
    state = { ...state, ...updates };
    
    // Append log if provided
    if (newLog) {
        const timestamp = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        if (!state.logs) state.logs = [];
        state.logs.push({ 
            timestamp, 
            source: newLog.source || "server",
            ...newLog 
        });
        if (state.logs.length > 200) state.logs.shift();
    }
    
    state.lastHeartbeat = Date.now();
    await setConfig(db, "explore_state", JSON.stringify(state));
    return state;
}

app.get("/explore/status", async (c) => {
  const db = await getDb(c);
  
  // Set no-cache headers
  c.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  c.header("Surrogate-Control", "no-store");

  let statusStr = await getConfig(db, "explore_state", "null");
  let data = statusStr === "null" ? { status: "idle" } : JSON.parse(statusStr);
  
  let isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
  const cronSecret = (c.env && (c.env as any).CRON_SECRET) || "update_celeb";
  if (!isAdmin && c.req.header("x-admin-password") === cronSecret) {
      isAdmin = true;
  }
  
  // Consistency check: If status is running but target is missing, try to recover it from queue
  if (data && data.status === 'running' && !data.target) {
      const activeTask = await db.prepare("SELECT target_name FROM explore_queue WHERE status = 'processing' ORDER BY updated_at DESC LIMIT 1").get() as any;
      if (activeTask) {
          data.target = activeTask.target_name;
          data.subStatus = 'processing';
      } else {
          const pendingTask = await db.prepare("SELECT target_name FROM explore_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1").get() as any;
          if (pendingTask) {
              data.target = pendingTask.target_name;
              data.subStatus = 'queued';
          }
      }
  }

  if (data && data.status === 'running') {
      const now = Date.now();
      const diff = now - (data.lastHeartbeat || now);
      if (diff > 600000) { // 600 seconds (10 minutes)
          // Just reset to idle or log it, don't set a blocking error message the user called outdated
          console.log(`[Status Check] Heartbeat stale (diff=${diff}ms). Resetting state to idle.`);
          await updateExplorationState(db, { status: "idle", subStatus: null, target: null }, { msg: "检测到集群执行节点心跳丢失，系统已重置状态。", type: "error", source: "server" });
          data.status = 'idle';
          data.target = null;
      }
  }

  data.isOwner = isAdmin;
  
  // Add queue info
  let pendingTasks = await db.prepare("SELECT target_name FROM explore_queue WHERE status = 'pending' ORDER BY priority DESC, created_at ASC").all() as any[];

  // Periodically clean up completed or successfully archived tasks to prevent infinite growth
  // We keep 'error' tasks so that the blacklist (failed 3 times) continues to work.
  if (Math.random() < 0.1) {
      db.prepare("DELETE FROM explore_queue WHERE status = 'completed' AND updated_at < date('now', '-3 days')").run().catch(e => console.error(e));
  }
  
  const refillEnabled = await getConfig(db, "auto_refill_enabled", "false") === "true";
  data.autoRefillEnabled = refillEnabled;

  // Proactive Auto-refill logic: ensure at least 1 person is ALWAYS waiting (pending) in the queue if refill is enabled.
  // We check if there are no 'pending' tasks (regardless of whether one is 'processing').
  const actualPendingCount = (await db.prepare("SELECT COUNT(*) as count FROM explore_queue WHERE status = 'pending'").get() as any).count;
  
  if (refillEnabled && actualPendingCount === 0) {
      const { targetName, isEmpty } = await pickTarget(db);
      if (!isEmpty && targetName) {
          // Check if already in processing to avoid picking the same thing
          const inProcessing = await db.prepare("SELECT COUNT(*) as count FROM explore_queue WHERE target_name = ? AND status = 'processing'").get(targetName) as any;
          if (inProcessing.count === 0) {
              // Prevent concurrent polling race conditions where multiple requests yielded during pickTarget
              const doubleCheck = (await db.prepare("SELECT COUNT(*) as count FROM explore_queue WHERE status = 'pending'").get() as any).count;
              if (doubleCheck === 0) {
                  await db.prepare("INSERT INTO explore_queue (target_name, priority) VALUES (?, 1)").run(targetName);
              }
              // Refresh pending tasks after refill (whether we inserted or another request inserted)
              pendingTasks = await db.prepare("SELECT target_name FROM explore_queue WHERE status = 'pending' ORDER BY priority DESC, created_at ASC").all() as any[];
          }
      }
  }

  data.queue = pendingTasks.map(t => t.target_name);

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

// Helper to verify inner secret
const checkInternalSecret = (c: any) => {
    const headerSec = c.req.header("Authorization");
    const internalSecret = (c.env && (c.env as any).CRON_SECRET) || "update_celeb";
    return headerSec === `Bearer ${internalSecret}`;
};

// 1. Worker fetches next task
app.get("/internal/next-task", async (c) => {
    const isAuthorized = checkInternalSecret(c);
    console.log(`[Internal] next-task requested. Authorized: ${isAuthorized}`);
    if (!isAuthorized) return c.json({ error: "Unauthorized" }, 401);
    
    const db = await getDb(c);
    
    // Pick highest priority task, or a stale processing task (> 10 mins)
    const task = await db.prepare(`
        SELECT * FROM explore_queue 
        WHERE status = 'pending' 
        OR (status = 'processing' AND updated_at < datetime('now', '-10 minutes')) 
        ORDER BY priority DESC, created_at ASC 
        LIMIT 1
    `).get() as any;
    
    const modelConfig = {
        provider: await getConfig(db, "active_model_provider", "gemini"),
        apiKey: await getConfig(db, "gemini_api_key") || (c.env && c.env.GEMINI_API_KEY) || "",
        aliyunApiKey: await getConfig(db, "aliyun_api_key") || "",
        aliyunModelId: await getConfig(db, "aliyun_model_id") || "qwen-max",
        modelId: await getConfig(db, "gemini_model_id") || "gemini-1.5-flash",
    };
    
    let taskToProcess = task;
    
    // Auto-fill logic: if queue empty and refill enabled, pick a random target
    if (!taskToProcess) {
        const refillEnabled = await getConfig(db, "auto_refill_enabled", "false") === "true";
        if (refillEnabled) {
            console.log(`[Internal] Queue empty, auto-refill enabled. Picking random target...`);
            const { targetName, isEmpty } = await pickTarget(db);
            if (!isEmpty && targetName) {
                // Use run() for broader compatibility and consistency
                const res = await db.prepare("INSERT INTO explore_queue (target_name, priority) VALUES (?, 1)").run(targetName);
                const taskId = res.lastInsertRowid;
                taskToProcess = { id: taskId, target_name: targetName };
                console.log(`[Internal] Auto-enqueued: ${targetName} (ID: ${taskId})`);
            }
        }
    }
    
    if (taskToProcess) {
        const taskId = taskToProcess.id || taskToProcess.lastInsertRowid;
        console.log(`[Internal] Task found/auto-filled: ${taskToProcess.target_name} (ID: ${taskId})`);
        await db.prepare("UPDATE explore_queue SET status = 'processing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(taskId);
        await updateExplorationState(db, { status: "running", subStatus: "processing", taskId: Number(taskId), target: taskToProcess.target_name }, { msg: `[Worker] 已承接并开始执行任务: ${taskToProcess.target_name}`, type: "api", source: "worker" });
        return c.json({ taskId: Number(taskId), targetName: taskToProcess.target_name, modelConfig });
    } else {
        // If we are idle but the state still says running, reset it
        let currentStr = await getConfig(db, "explore_state", "null");
        if (currentStr !== "null") {
            const state = JSON.parse(currentStr);
            if (state.status === 'running') {
                await updateExplorationState(db, { status: "idle", subStatus: null, target: null }, { msg: "所有任务已处理完毕，集群进入待命状态。", type: "info" });
            }
        }
        return c.json({ error: "No pending tasks" }, 404);
    }
});

// 2. Worker reports state
app.post("/internal/state", async (c) => {
    if (!checkInternalSecret(c)) return c.json({ error: "Unauthorized" }, 401);
    const db = await getDb(c);
    const updates = await c.req.json();
    
    console.log(`[Internal] State sync from worker: status=${updates.status || 'N/A'}, target=${updates.target || 'N/A'}`);
    await updateExplorationState(db, updates);
    return c.json({ success: true });
});

// 3. Worker reports step logs
app.post("/internal/log", async (c) => {
    if (!checkInternalSecret(c)) return c.json({ error: "Unauthorized" }, 401);
    const db = await getDb(c);
    const { taskId, type, msg, data } = await c.req.json();
    console.log(`[Internal Log] [Worker] [${type}] ${msg}`);
    try {
        await db.prepare("INSERT INTO task_logs (task_id, type, msg, data) VALUES (?, ?, ?, ?)").run(String(taskId), type, msg, data ? JSON.stringify(data) : null);
        await updateExplorationState(db, {}, { msg, type, data, source: "worker" });
    } catch (e) {}
    return c.json({ success: true });
});

// 4. Worker submits final success/error
app.post("/internal/submit", async (c) => {
    if (!checkInternalSecret(c)) return c.json({ error: "Unauthorized" }, 401);
    const db = await getDb(c);
    const body = await c.req.json();
    const { taskId, success, personData, wikiMeta, error } = body;
    const targetName = sify((body.targetName || "").trim());
    
    if (success) {
        // Validate effective information before proceeding
        const achievements = personData?.achievements || [];
        const relationships = personData?.relationships || [];
        
        const hasEffectiveAchievements = Array.isArray(achievements) && achievements.length > 0 && achievements.some((a: any) => String(a).trim().length > 2);
        const hasEffectiveRelationships = Array.isArray(relationships) && relationships.length > 0 && relationships.some((r: any) => r.personName && String(r.relationshipType).trim().length > 2);

        if (!hasEffectiveAchievements || !hasEffectiveRelationships) {
             const reason = !hasEffectiveAchievements && !hasEffectiveRelationships 
                ? "主要成就与时空关系网均无有效信息" 
                : (!hasEffectiveAchievements ? "主要成就数据缺失或过短" : "时空关系网络数据缺失或无效");
             
             if (taskId) {
                await db.prepare("UPDATE explore_queue SET status = 'error', reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run("落库校验中止: " + reason, taskId);
             }
             await updateExplorationState(db, { status: "error", error: `时空锁死：经 AI 高维扫描，该人物的${reason}。为维持馆藏档案品质，已强制中止本次入库。` }, { msg: `入库强制中止：${reason} [${targetName}]`, type: "error" });
             return c.json({ success: false, error: reason });
        }

        // Mark task as completed
        if (taskId) {
            await db.prepare("UPDATE explore_queue SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(taskId);
        }
        await updateExplorationState(db, { status: "running" }, { msg: `Worker 提交数据成功，开始进行同步落库 (${targetName})`, type: "api" });
        
        const finalizeLogs: any[] = [];
        // Save to D1
        try {
            const { isUpdate } = await doFinalizeInsert(db, targetName, personData, wikiMeta, c,
               addRelationship,
               (msg: string, type: string) => {
                 finalizeLogs.push({ msg, type });
                 db.prepare("INSERT INTO task_logs (task_id, type, msg) VALUES (?, ?, ?)").run(String(taskId || 'sys'), type, msg).catch(()=>null);
                 updateExplorationState(db, {}, { msg, type }).catch(()=>null);
               },
               async (relatedName, relType) => {
                 // 严格类型检查，防止 AI 输出异常导致的程序崩溃
                 if (typeof relatedName !== "string") return;
                 
                 const normalizedRelation = sify(relatedName.trim());
                 if (!normalizedRelation || normalizedRelation.length < 2 || normalizedRelation.length > 40) return;

                 // 拦截检测：如果姓名中包含英文 A-Z (且不是极短的特殊缩写)，则视为未翻译别名，不入排队队列
                 if (/[a-zA-Z]/.test(normalizedRelation) && normalizedRelation.length > 4) {
                    console.log(`[Sanity Check] 拦截到非规范外文关联人: ${normalizedRelation}，已跳过自动排队。`);
                    return;
                 }
                 
                 // Reuse enqueue logic
                 const existingRel = await db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(normalizedRelation) as any;
                 if (existingRel) return;

                 const inQueue = await db.prepare("SELECT id FROM explore_queue WHERE target_name = ? AND (status = 'pending' OR status = 'processing' OR status = 'completed') COLLATE NOCASE").get(normalizedRelation) as any;
                 if (inQueue) return;

                 // 限制自动补位：如果队列中已有待处理或处理中的任务，则不再自动发现新关联
                 const queueCount = await db.prepare("SELECT COUNT(*) as count FROM explore_queue WHERE (status = 'pending' OR status = 'processing')").get() as { count: number };
                 if (queueCount.count >= 1) return;

                 // 实时暖机：当队列完全空了时，若开启了自动任务补位，我们使用 pickTarget 获取全局优先级最高的人物进行补位，不放空队列
                 const refillEnabled = await getConfig(db, "auto_refill_enabled", "false") === "true";
                 if (refillEnabled) {
                     const { targetName: globalTarget, isEmpty } = await pickTarget(db);
                     if (!isEmpty && globalTarget) {
                         const inQueueCheck = await db.prepare("SELECT id FROM explore_queue WHERE target_name = ? AND (status = 'pending' OR status = 'processing') COLLATE NOCASE").get(globalTarget) as any;
                         if (!inQueueCheck) {
                             await db.prepare("INSERT INTO explore_queue (target_name, priority, reason) VALUES (?, 1, ?)").run(globalTarget, `自动补位：由[${targetName}]完成落库触发的全局关联排序暖机`);
                             console.log(`[Queue Control] 实时暖机自动排入全局最高优先级人物：${globalTarget}`);
                         }
                     }
                 }
                 return;

                 // 确定优先级：只有当 FIGURE_POOL 全部入库后，才通过关系网自动发现无关预设的人物
                 const flatPool = Object.values(FIGURE_POOL).flat();
                 const isInPool = flatPool.some(n => n.toLowerCase() === normalizedRelation.toLowerCase());
                 
                 if (!isInPool) {
                    const archivedNamesRows = await db.prepare("SELECT name FROM people").all() as any[];
                    const archivedSet = new Set(archivedNamesRows.map(p => p.name.toLowerCase()));
                    
                    const queuedNamesRows = await db.prepare("SELECT target_name FROM explore_queue").all() as any[];
                    queuedNamesRows.forEach(p => archivedSet.add(p.target_name.toLowerCase()));

                    const poolLeft = flatPool.some(n => !archivedSet.has(n.toLowerCase()));
                    if (poolLeft) {
                        console.log(`[Queue Control] 跳过关联发现: [${normalizedRelation}]，优先填补预设池人物。`);
                        return;
                    }
                 }

                 await db.prepare("INSERT INTO explore_queue (target_name, priority, reason) VALUES (?, 1, ?)").run(normalizedRelation, `由[${targetName}]的时空关系网自动发现`);
               }
            );
            
            if (isUpdate) {
                await updateExplorationState(db, { status: "success", newArrivals: [] }, { msg: `[${targetName}] 已在馆藏中，档案数据已完成增量更新并在时空轴前移。`, type: "success" });
            } else {
                await updateExplorationState(db, { status: "success", newArrivals: [targetName] }, { msg: `任务落库成功，[${targetName}] 正式入驻中心档案库。`, type: "api" });
            }
            return c.json({ success: true, serverLogs: finalizeLogs });
        } catch (e: any) {
            console.error("Save error:", e);
            await updateExplorationState(db, { status: "error", error: e.message }, { msg: `任务落库失败: ${e.message}`, type: "error" });
            return c.json({ success: false, error: e.message });
        }
    } else {
        if (taskId) {
            await db.prepare("UPDATE explore_queue SET status = 'error', reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(error || "Worker 任务执行失败", taskId);
        }
        await updateExplorationState(db, { status: "error", error: error || "Worker 任务执行失败" }, { msg: `Worker 汇报任务失败: ${error}`, type: "error" });
    }
    
    return c.json({ success: true });
});

app.get("/admin/stats", async (c) => {
    const db = await getDb(c);
    const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
    if (!isAdmin) return c.json({ error: "Unauthorized" }, 401);
    
    // Total figures pool
    const totalPool = Object.values(FIGURE_POOL).reduce((acc, curr) => acc + curr.length, 0);
    
    let archivedPoolCount = 0;
    let connectedTotalCountUnique = 0;
    let connectedArchivedCount = 0;
    let blacklistCount = 0;
    let photoBlacklistCount = 0;
    let otherBlacklistCount = 0;
    const queryErrors: Record<string, string> = {};

    // 1. Archived preset count
    try {
        const archivedPresetRow = await db.prepare("SELECT COUNT(*) as count FROM figure_pool_sync WHERE is_archived = 1").get() as any;
        archivedPoolCount = archivedPresetRow ? archivedPresetRow.count : 0;
    } catch (e: any) {
        queryErrors.archivedPoolCount = e.message || String(e);
        console.error("Error fetching archivedPoolCount:", e);
    }
    
    // 2. Connected total count
    try {
        const allPeopleRows = await db.prepare("SELECT raw_relationships FROM people").all() as any[];
        const allConnectedNames = new Set<string>();
        allPeopleRows.forEach(row => {
            try {
                const rels = JSON.parse(row.raw_relationships || "[]");
                rels.forEach((r: any) => {
                    if (r.personName) allConnectedNames.add(r.personName.trim().toLowerCase());
                });
            } catch(e) {}
        });
        const archivedNamesRows = await db.prepare("SELECT name FROM people").all() as any[];
        archivedNamesRows.forEach(row => {
            if (row.name) allConnectedNames.add(row.name.trim().toLowerCase());
        });
        connectedTotalCountUnique = allConnectedNames.size;
    } catch (e: any) {
        queryErrors.connectedTotalCountUnique = e.message || String(e);
        console.error("Error fetching connectedTotalCountUnique:", e);
    }
    
    // 3. Connected count among archived
    try {
        const connectedArchivedRows = await db.prepare("SELECT DISTINCT p.id FROM people p JOIN relationships r ON p.id = r.person1_id OR p.id = r.person2_id").all() as any[];
        connectedArchivedCount = connectedArchivedRows.length;
    } catch (e: any) {
        queryErrors.connectedArchivedCount = e.message || String(e);
        console.error("Error fetching connectedArchivedCount:", e);
    }
    
    // 4. Photo blacklist count
    try {
        const photoBlacklistRows = await db.prepare(`
            SELECT target_name 
            FROM explore_queue 
            WHERE status = 'error' 
            GROUP BY target_name 
            HAVING SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) >= 2
        `).all() as any[];
        photoBlacklistCount = photoBlacklistRows.length;
    } catch (e: any) {
        queryErrors.photoBlacklistCount = e.message || String(e);
        console.error("Error fetching photoBlacklistCount:", e);
    }

    // 5. Other blacklist count
    try {
        const otherBlacklistRows = await db.prepare(`
            SELECT target_name 
            FROM explore_queue 
            WHERE status = 'error' 
            GROUP BY target_name 
            HAVING (COUNT(*) - SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END)) >= 2
        `).all() as any[];
        otherBlacklistCount = otherBlacklistRows.length;
    } catch (e: any) {
        queryErrors.otherBlacklistCount = e.message || String(e);
        console.error("Error fetching otherBlacklistCount:", e);
    }

    // 6. Blacklist count
    try {
        const failedPeopleRows = await db.prepare(`
            SELECT target_name 
            FROM explore_queue 
            WHERE status = 'error' 
            GROUP BY target_name 
            HAVING SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) >= 2 
               OR (COUNT(*) - SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END)) >= 2
        `).all() as any[];
        blacklistCount = failedPeopleRows.length;
    } catch (e: any) {
        queryErrors.blacklistCount = e.message || String(e);
        console.error("Error fetching blacklistCount:", e);
    }

    return c.json({
        totalPool,
        archivedPool: archivedPoolCount,
        connectedTotal: connectedTotalCountUnique,
        connectedArchived: connectedArchivedCount,
        blacklistCount,
        photoBlacklistCount,
        otherBlacklistCount,
        queryErrors: Object.keys(queryErrors).length > 0 ? queryErrors : undefined
    });
});

app.post("/admin/realign-wikidata", async (c) => {
    const db = await getDb(c);
    const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
    if (!isAdmin) return c.json({ error: "Unauthorized" }, 401);

    let stats;
    try {
        stats = await runBackgroundAlignment(db);
    } catch (err) {
        console.error("[Wikidata Sync Manual] Error during manual alignment:", err);
        return c.json({ success: false, error: "Alignment failed. Check logs." }, 500);
    }

    return c.json({ 
        success: true, 
        message: `对齐完成！已入库总人数: ${stats?.totalPeople || 0} 人，已对齐: ${stats?.alignedPeople || 0} 人，本次对齐: ${stats?.newlyAlignedPeople || 0} 人 (预设池: ${stats?.newlyAlignedPool || 0} 个)。` 
    });
});

app.get("/admin/export-alignment", async (c) => {
    const db = await getDb(c);
    const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
    if (!isAdmin) return c.json({ error: "Unauthorized" }, 401);

    try {
        const people = await db.prepare("SELECT * FROM people ORDER BY id ASC").all() as any[];
        
        // CSV headers
        const headers = ["ID(序号)", "姓名", "分类", "关键词", "生卒寿命", "出生地", "Wikidata ID(对齐标识)", "访问次数", "入库时间", "简要传记(首150字)"];
        const rows = people.map(p => {
            const escape = (val: any) => {
                if (val === null || val === undefined) return "";
                const str = String(val).replace(/"/g, '""').replace(/\r?\n|\r/g, " "); // Escape double quotes & handle newlines
                if (str.includes(",") || str.includes('"')) {
                    return `"${str}"`;
                }
                return str;
            };
            return [
                p.id,
                escape(p.name),
                escape(p.category),
                escape(p.keyword),
                escape(p.lifespan),
                escape(p.birthplace),
                escape(p.wikidata_id || "未对齐"),
                p.views,
                escape(p.created_at),
                escape((p.biography || "").slice(0, 150) + ((p.biography || "").length > 150 ? "..." : ""))
            ].join(",");
        });

        const csvContent = "\ufeff" + [headers.join(","), ...rows].join("\n");
        return c.text(csvContent, 200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="spacetime_alignment_report_${new Date().toISOString().slice(0, 10)}.csv"`
        });
    } catch (err: any) {
        console.error("Export alignment error:", err);
        return c.json({ error: "Export failed: " + err.message }, 500);
    }
});

app.get("/admin/blacklist", async (c) => {
    const db = await getDb(c);
    const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
    if (!isAdmin) return c.json({ error: "Unauthorized" }, 401);
    
    const type = c.req.query("type");
    let rows: any[] = [];
    if (type === "photos") {
        rows = await db.prepare(`
            SELECT target_name 
            FROM explore_queue 
            WHERE status = 'error' 
            GROUP BY LOWER(target_name) 
            HAVING SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) >= 2
        `).all() as any[];
    } else if (type === "others") {
        rows = await db.prepare(`
            SELECT target_name 
            FROM explore_queue 
            WHERE status = 'error' 
            GROUP BY LOWER(target_name) 
            HAVING (COUNT(*) - SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END)) >= 2
        `).all() as any[];
    } else {
        rows = await db.prepare(`
            SELECT target_name 
            FROM explore_queue 
            WHERE status = 'error' 
            GROUP BY LOWER(target_name) 
            HAVING SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) >= 2 
               OR (COUNT(*) - SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END)) >= 2
        `).all() as any[];
    }
    
    const names = [];
    for (const r of rows) {
        const target = r.target_name;
        const errRows = await db.prepare("SELECT reason, created_at FROM explore_queue WHERE LOWER(target_name) = ? AND status = 'error' ORDER BY created_at ASC").all(target.toLowerCase()) as any[];
        const reasons = errRows.map(er => {
            const dateStr = er.created_at ? er.created_at.substring(5, 16) : "未知时间";
            return `[${dateStr}] ${er.reason || "未知原因"}`;
        }).join(" | ");
        names.push(`${target} (共失败 ${errRows.length} 次: ${reasons})`);
    }
    return c.json(names);
});

// Admin enqueues a target manually
app.post("/explore/enqueue", async (c) => {
    const db = await getDb(c);
    const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
    if (!isAdmin) return c.json({ error: "Unauthorized" }, 401);
    
    let { targetName } = await c.req.json();
    if (!targetName) return c.json({ error: "Invalid target" }, 400);
    targetName = sify(targetName.trim());
    
    // Check if already in people table
    const existingPerson = await db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(targetName) as any;
    if (existingPerson) {
        return c.json({ error: `[${targetName}] 已在档案库中，无需入队。`, alreadyExists: true }, 400);
    }
    
    // Check if blacklisted
    const errStats = await db.prepare(`
        SELECT 
          COUNT(*) as total_errors,
          SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) as photo_errors
        FROM explore_queue
        WHERE LOWER(target_name) = ? AND status = 'error'
    `).get(targetName.toLowerCase()) as { total_errors: number, photo_errors: number };

    const totalErrors = errStats?.total_errors || 0;
    const photoErrors = errStats?.photo_errors || 0;
    const otherErrors = totalErrors - photoErrors;
    if (photoErrors >= 2 || otherErrors >= 2) {
        const bReason = photoErrors >= 2 ? `Wikidata 缺少相片入库失败达 ${photoErrors} 次` : `AI调用/系统错误落库失败达 ${otherErrors} 次`;
        return c.json({ error: `[${targetName}] 已触碰时空偏航熔断规则（${bReason}），已被系统自动拦截，不可再入库。` }, 400);
    }
    
    // Check if already in queue
    const existingQueue = await db.prepare("SELECT id FROM explore_queue WHERE target_name = ? AND (status = 'pending' OR status = 'processing') COLLATE NOCASE").get(targetName) as any;
    if (existingQueue) {
        return c.json({ error: `[${targetName}] 已在队列中，请勿重复添加。`, alreadyQueued: true }, 400);
    }

    const queueCount = await db.prepare("SELECT COUNT(*) as count FROM explore_queue WHERE status = 'pending' OR status = 'processing'").get() as { count: number };
    if (queueCount.count >= 20) {
        return c.json({ error: "队列已满 (当前最大 20 人)，请等待 Worker 消化。" }, 400);
    }
    
    // Priority 1 triggers it ahead of background auto-tasks (priority 0)
    const res = await db.prepare("INSERT INTO explore_queue (target_name, priority) VALUES (?, 1) RETURNING id").get(targetName) as any;
    const taskId = res.id;
    
    // Initialize/Update state so UI sees the task is queued
    // We update the state to the latest queued task, but we also keep the queue info in the response
    await updateExplorationState(db, {
        status: "running",
        subStatus: "queued",
        target: targetName,
        taskId: taskId,
        error: null
    }, { msg: `[Pages] 提交入队请求: ${targetName}`, type: "api", source: "pages" });
    
    return c.json({ success: true, message: `已将 ${targetName} 加入探索队列！后台 Worker 会自动拉取执行。`, taskId });
});

app.post("/explore/start", async (c) => {
  const db = await getDb(c);
  const { target, isAdmin, clientTaskId, source: reqSource } = await c.req.json();
  
  if (!isAdmin && await getConfig(db, "demo_mode") === "true") {
      return c.json({ error: "只读模式，如需演示，请访问项目GitHub" }, 403);
  }

  // Redirection: use enqueue for all exploration starts
  const targetName = sify((target || "").trim());
  if (!targetName) return c.json({ error: "探索目标不能为空" }, 400);

  // Check if already in people table
  const existingPerson = await db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(targetName) as any;
  if (existingPerson) {
      return c.json({ success: true, message: `[${targetName}] 已在馆藏中，档案数据将会被激活并展示。`, alreadyExists: true, personId: existingPerson.id });
  }

  // Check if blacklisted
  const errStats = await db.prepare(`
      SELECT 
        COUNT(*) as total_errors,
        SUM(CASE WHEN reason LIKE '%缺少真实相片%' THEN 1 ELSE 0 END) as photo_errors
      FROM explore_queue
      WHERE LOWER(target_name) = ? AND status = 'error'
  `).get(targetName.toLowerCase()) as { total_errors: number, photo_errors: number };

  const totalErrors = errStats?.total_errors || 0;
  const photoErrors = errStats?.photo_errors || 0;
  const otherErrors = totalErrors - photoErrors;
  if (photoErrors >= 2 || otherErrors >= 2) {
      const bReason = photoErrors >= 2 ? `Wikidata 缺少相片入库失败达 ${photoErrors} 次` : `AI调用/系统错误落库失败达 ${otherErrors} 次`;
      return c.json({ error: `[${targetName}] 已触碰时空偏航熔断规则（${bReason}），已被系统自动拦截，不可再入库。` }, 400);
  }

  // Check if already in queue
  const existingQueue = await db.prepare("SELECT id FROM explore_queue WHERE target_name = ? AND (status = 'pending' OR status = 'processing') COLLATE NOCASE").get(targetName) as any;
  if (existingQueue) {
      return c.json({ success: true, message: "该人物已在队列中，任务已激活。" });
  }

  // 手动入队限制：最多 20 人
  const queueCount = await db.prepare("SELECT COUNT(*) as count FROM explore_queue WHERE status = 'pending' OR status = 'processing'").get() as { count: number };
  if (queueCount.count >= 20) {
      return c.json({ error: "探索队列已满 (最大 20 人)，请等待 Worker 消化后再试。" }, 400);
  }

  const res = await db.prepare("INSERT INTO explore_queue (target_name, priority) VALUES (?, 1) RETURNING id").get(targetName) as any;
  const taskId = res.id;
  
  await updateExplorationState(db, {
      status: "running",
      subStatus: "queued",
      target: targetName,
      taskId: taskId,
      source: reqSource || 'explorer',
      error: null
  }, { msg: `[Pages] 请求发布任务至集群: ${targetName}`, type: "api", source: "pages" });

  return c.json({ success: true, taskId, targetName });
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
         await updateExplorationState(db, {}, { msg: "[Pages] 用户中止了当前探测任务", type: "error", source: "pages" });
      }
  }
  return c.json({ success: true });
});

app.post("/explore/dequeue", async (c) => {
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);
  if (!isAdmin) return c.json({ error: "Unauthorized" }, 401);
  const db = await getDb(c);
  const { targetName } = await c.req.json();
  if (!targetName) return c.json({ error: "Missing targetName" }, 400);
  
  await db.prepare("DELETE FROM explore_queue WHERE target_name = ? AND status = 'pending'").run(targetName);
  return c.json({ success: true });
});

app.post("/explore/reset", async (c) => {
  const db = await getDb(c);
  const isAdmin = c.req.header("x-admin-password") === getAdminPassword(c);

  if (!isAdmin) {
      return c.json({ error: "无权操作" }, 403);
  }

  let statusStr = await getConfig(db, "explore_state", "null");
  if (statusStr !== "null") {
      let state = JSON.parse(statusStr);
      state.status = "idle";
      state.target = null;
      state.subStatus = null;
      state.steps = [];
      // Keep state.logs for persistent rolling logs
      await setConfig(db, "explore_state", JSON.stringify(state));
      await updateExplorationState(db, {}, { msg: "[Pages] 重置集群状态与当前任务", type: "info", source: "pages" });
  } else {
      await setConfig(db, "explore_state", JSON.stringify({ status: "idle", logs: [], steps: [] }));
  }
  
  return c.json({ success: true });
});

// Added cron endpoint
app.post("/api/cron/get-target", async (c) => {
    const now = Date.now();
    console.log(`[Cron Get Target] ${new Date(now).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} 请求参数`);
    const secret = c.req.query("secret");
    const force = c.req.query("force") === "true";

    const cronSecret = (c.env && c.env.CRON_SECRET) || "update_celeb";
    if (secret !== cronSecret && c.req.header("x-admin-password") !== getAdminPassword(c)) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    
    const db = await getDb(c);
    
    await setConfig(db, "last_cron_message_time", String(now));
    
    let currentStr = await getConfig(db, "explore_state", "null");
    if (currentStr !== "null") {
        try {
            const current = JSON.parse(currentStr);
            const isStale = current.status === 'running' && (!current.lastHeartbeat || (Date.now() - current.lastHeartbeat > 600000));
            if (current.status === 'running' && !isStale) {
                return c.json({ status: "skipped", message: "探索正在进行中，跳过本次触发" });
            }
        } catch(e) {}
    }

    const intervalEnabled = await getConfig(db, "cron_interval_enabled", "false") === "true";
    if (!force && !intervalEnabled) {
        return c.json({ status: "skipped", message: "后台自动探索控制已关闭" });
    }

    const lastTrigger = await getConfig(db, "last_cron_trigger_time", "");
    if (!force && intervalEnabled && lastTrigger) {
        const lastTime = parseInt(lastTrigger);
        const hours = parseInt(await getConfig(db, "cron_interval_hours", "0"));
        const mins = parseInt(await getConfig(db, "cron_interval_minutes", "0"));
        const intervalMs = (hours * 3600 + mins * 60) * 1000;
        
        if (now - lastTime < intervalMs) {
            return c.json({ 
                status: "skipped", 
                message: "间隔时间未到，自动探索任务跳过", 
            });
        }
    }

    const { targetName, isEmpty } = await pickTarget(db);
    
    if (isEmpty || !targetName) {
        return c.json({ status: "no target found", isEmpty, message: "已无更多人物可探索" });
    }
    
    // Process previous pending result
    try {
        const pendingResultStr = await getConfig(db, "pending_auto_result", "null");
        if (pendingResultStr !== "null") {
            const pendingParams = JSON.parse(pendingResultStr);
            await doFinalizeInsert(db, pendingParams.finalName, pendingParams.personData, pendingParams.wikiMeta, c, addRelationship, null);
            await setConfig(db, "pending_auto_result", "null");
        }
    } catch(e) {
        console.error("[Cron] 上次结果入库失败", e);
    }
    
    await setConfig(db, "last_cron_trigger_time", String(now));

    const newTaskId = Date.now();
    await initExplorationState(db, getConfig, setConfig, targetName, 'auto', newTaskId);
    console.log(`[Cron] Initialized state machine for ${targetName}`);

    return c.json({ status: "success", targetName, taskId: newTaskId });
});

app.post("/api/cron/notify-result", async (c) => {
    const secret = c.req.query("secret");
    const cronSecret = (c.env && c.env.CRON_SECRET) || "update_celeb";
    if (secret !== cronSecret && c.req.header("x-admin-password") !== getAdminPassword(c)) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const { targetName, result } = await c.req.json();
    console.log(`[Cron Notify Result] 收到 Queue 的处理结果: target=${targetName}, status=${result.status}`);
    
    const db = await getDb(c);
    // Any extra cleanup or logging can be added here. (the main finalization is handled within advanceExplorationStep)
    await setConfig(db, "last_queue_result", JSON.stringify({ targetName, result, t: Date.now() }));
    
    return c.json({ success: true, message: "结果已记录" });
});
