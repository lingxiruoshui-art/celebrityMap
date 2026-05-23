import { DatabaseAdapter } from "./db.ts";
import { ExploreState } from "./exploreTask.ts";
import { sify } from "chinese-conv";

async function fetchWikidataId(name: string): Promise<string | null> {
    const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
    try {
        const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=zh&format=json`, { headers });
        const data = await res.json() as any;
        return data.search?.[0]?.id || null;
    } catch (e) {
        return null;
    }
}

export async function initExplorationState(
  db: DatabaseAdapter,
  getConfig: any,
  setConfig: any,
  target: string,
  source: string,
  providedTaskId?: number
): Promise<ExploreState> {
  const state: ExploreState = {
    status: "running",
    subStatus: "processing",
    phase: "init",
    target,
    source: source || 'explorer',
    taskId: providedTaskId || Date.now(),
    lastHeartbeat: Date.now(),
    pulse: 0,
    logs: [{ timestamp: new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), msg: `初始化任务: [${target || '随机发散探索'}]`, type: 'info' }],
    steps: [{ msg: "探索序列启动中...", status: "pending", startTime: Date.now() }],
    path: null,
    error: null,
    newArrivals: [],
  };
  await setConfig(db, "explore_state", JSON.stringify(state));
  return state;
}

export async function doFinalizeInsert(db: DatabaseAdapter, finalName: string, personData: any, wikiMeta: any, c: any, addRelationship: any, addLog: any, onDiscover?: (name: string, type: string) => Promise<void>) {
    finalName = sify(finalName.trim());
    if (personData.relationships && Array.isArray(personData.relationships)) {
        personData.relationships = personData.relationships.map((rel: any) => ({
            ...rel,
            personName: sify((rel.personName || "").trim())
        }));
    }

    const portraitUrlRaw = wikiMeta?.imageUrl;
    const portraitUrl = `/api/portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`;
    if (c.env && c.env.IMAGES && portraitUrlRaw) {
        try {
            console.log(`[doFinalizeInsert] 正在抓取画像 -> ${portraitUrlRaw}`);
            const imgRes = await fetch(portraitUrlRaw);
            if (imgRes.ok) {
                const buffer = await imgRes.arrayBuffer();
                await c.env.IMAGES.put(`portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`, buffer, {
                    httpMetadata: { contentType: imgRes.headers.get("content-type") || "image/jpeg" }
                });
                if (addLog) addLog(`肖像同步成功`, "success");
            }
        } catch(e) {
            console.log(`[doFinalizeInsert] 画像抓取失败，略过`, e);
        }
    }
    
    // Check if exists for logging purposes
    const existing = await db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(finalName) as any;
    const isUpdate = !!existing;

    // Resolve Wikidata ID for the person
    let wikidataId = wikiMeta?.wikidataId || null;
    if (!wikidataId) {
        wikidataId = await fetchWikidataId(finalName);
    }

    const res = await db.prepare(
        `INSERT INTO people (name, category, keyword, biography, achievements, raw_relationships, lifespan, birthplace, image_url, wikidata_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET 
            category=excluded.category, keyword=excluded.keyword, biography=excluded.biography, image_url=excluded.image_url,
            achievements=excluded.achievements, raw_relationships=excluded.raw_relationships, lifespan=excluded.lifespan, birthplace=excluded.birthplace,
            wikidata_id=COALESCE(excluded.wikidata_id, people.wikidata_id),
            created_at=CURRENT_TIMESTAMP
         RETURNING id`
    ).get(
        finalName, personData.category || "未知", personData.keyword || "", personData.biography || "", 
        JSON.stringify(personData.achievements || []), JSON.stringify(personData.relationships || []), 
        personData.lifespan || "", personData.birthplace || "", portraitUrl, wikidataId
    );
    
    let newId = (res as any)?.id;
    if (!newId && isUpdate) newId = existing.id;
    
    if (newId) {
        if (personData.relationships) {
            for (const rel of personData.relationships) {
                const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
                if (matched) {
                    await addRelationship(db, newId, matched.id, rel.relationshipType);
                } else if (onDiscover) {
                    await onDiscover(rel.personName, rel.relationshipType);
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
        `).all(newId, finalName) as any[];
        for (const p of previousMentions) {
            try {
                const rels = JSON.parse(p.raw_relationships || "[]");
                const matchingRel = rels.find((r: any) => r.personName === finalName);
                if (matchingRel) await addRelationship(db, p.id, newId, matchingRel.relationshipType);
            } catch(e) {}
        }

        // Mark as archived in figure_pool_sync if it matches a preset (simplified elegant match using Wikidata ID)
        try {
            if (wikidataId) {
                await db.prepare(`
                    UPDATE figure_pool_sync 
                    SET is_archived = 1, archived_person_id = ?, archived_name = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE (wikidata_id = ? OR LOWER(preset_name) = LOWER(?))
                `).run(newId, finalName, wikidataId, finalName);
            } else {
                await db.prepare(`
                    UPDATE figure_pool_sync 
                    SET is_archived = 1, archived_person_id = ?, archived_name = ?, updated_at = CURRENT_TIMESTAMP 
                    WHERE LOWER(preset_name) = LOWER(?)
                `).run(newId, finalName, finalName);
            }
        } catch (syncErr) {
            console.error("Failed to sync preset status on insertion in doFinalizeInsert:", syncErr);
        }
    }

    return { id: newId, isUpdate };
}
