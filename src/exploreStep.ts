import { DatabaseAdapter } from "./db.ts";
import { ExploreState } from "./exploreTask.ts";
import { sify } from "chinese-conv";

export function isCommonForbiddenName(name: string): boolean {
    const list = [
        "周恩来", "毛泽东", "邓小平", "刘少奇", "朱德", "彭德怀", "林彪", "江泽民", "胡锦涛", "习近平", "温家宝", "朱镕基", "李克强",
        "蒋介石", "孙中山", "宋美龄", "宋庆龄", "宋子文", "孔祥熙", "陈独秀", "李大钊", "刘德华", "张学良", "汪精卫", "李鹏", "赵紫阳", "华国锋"
    ];
    const n = sify(name.trim());
    return list.some(item => n.includes(item) || item.includes(n));
}

export function checkForbiddenBack(name: string, description: string, lifespan: string, biography: string): { forbidden: boolean, reason: string | null } {
    name = name || "";
    description = description || "";
    lifespan = lifespan || "";
    biography = biography || "";

    const fullText = (name + " " + description + " " + lifespan + " " + biography).toLowerCase();

    if (isCommonForbiddenName(name)) {
        return { forbidden: true, reason: `[${name}] 属于已知受限归档人物（中国近代政治家或当代在世名人）。本馆暂不予收录。` };
    }

    // 1. Check if living person
    let isLiving = false;
    
    if (lifespan) {
        const hasNow = lifespan.includes("至今") || lifespan.includes("现在") || lifespan.endsWith("-") || lifespan.endsWith("–");
        if (hasNow) {
            isLiving = true;
        }
        
        const years = lifespan.match(/(\d+)年/g);
        if (years && years.length > 0) {
            const birthYear = parseInt(years[0]);
            if (birthYear > 1905) {
                if (years.length === 1 && (lifespan.includes("-") || lifespan.includes("–") || lifespan.includes("~"))) {
                    isLiving = true;
                } else if (years.length === 2) {
                     // has birth and death, fine!
                } else {
                     isLiving = true;
                }
            }
        }
    }

    if (isLiving) {
        return { forbidden: true, reason: `[${name}] 属于现代在世人物。本时空博物馆仅收录并展示已经逝世的历史传奇。` };
    }

    // 2. Check if modern/contemporary Chinese politician/military/revolutionary
    let birthYear: number | null = null;
    if (lifespan) {
        const years = lifespan.match(/(\d+)年/g);
        if (years && years.length > 0) {
            birthYear = parseInt(years[0]);
        }
    }

    const isModernOrContemporary = !birthYear || birthYear >= 1800;
    const isOfChineseOrigin = name.match(/[\u4e00-\u9fa5]/) && (
        fullText.includes("中国") || 
        fullText.includes("中共") || 
        fullText.includes("中华") || 
        fullText.includes("清朝") || 
        fullText.includes("国民党") ||
        fullText.includes("内阁")
    );

    if (isOfChineseOrigin && isModernOrContemporary) {
        const politicalKeywords = [
            "政治", "革命", "总理", "总统", "主席", "书记", "外交", "军事", "元帅", "将军", 
            "中共", "共产党", "国民党", "建国", "起义", "内阁", "中委", "常委", "委员", 
            "领导人", "官僚", "大臣", "政客", "国务卿"
        ];
        
        const hasPoliticalKeyword = politicalKeywords.some(keyword => fullText.includes(keyword));
        if (hasPoliticalKeyword) {
            const strongPoliticalKeywords = [
                "总理", "总统", "主席", "书记", "外交部长", "政治局", "常委", "元帅", "蒋介石",
                "周恩来", "朱德", "刘少奇", "邓小平", "彭德怀", "林彪", "宋庆龄", "孙中山", "毛泽东",
                "政治家", "革命家", "国民党", "北洋", "大总统"
            ];
            const hasStrongPoliticalKeyword = strongPoliticalKeywords.some(keyword => fullText.includes(keyword));
            if (hasStrongPoliticalKeyword) {
                return { forbidden: true, reason: `[${name}] 属于中国近代或现代政治/军事/革命领导人物（系统解析到包含核心政治属性或敏感情境）。本馆暂不收录此类人物。` };
            }
        }
    }

    return { forbidden: false, reason: null };
}

function generateWikidataSearchTerms(name: string): string[] {
  const terms: string[] = [];
  const rawClean = name.trim();
  
  // 1. Original name as-is
  terms.push(rawClean);
  
  // 2. Simplified name
  const simplified = sify(rawClean);
  terms.push(simplified);

  // 3. Clean up hyphens and suffixes (e.g. "麦哲伦 - 智利南极大区")
  let strippedSuffix = rawClean;
  if (rawClean.includes(" - ")) {
    strippedSuffix = rawClean.split(" - ")[0].trim();
    terms.push(sify(strippedSuffix));
  } else if (rawClean.includes("-")) {
    const splitDash = rawClean.split("-");
    if (splitDash.length > 1 && splitDash[splitDash.length - 1].trim().length > 5) {
      strippedSuffix = splitDash[0].trim();
      terms.push(sify(strippedSuffix));
    }
  }

  // 4. Clean trailing punctuation/symbols (like ending dot/·)
  const cleanTrailing = strippedSuffix.replace(/[·\-\s\.]+$/, "").trim();
  if (cleanTrailing !== rawClean) {
    terms.push(sify(cleanTrailing));
  }

  // 5. Hardcoded high-frequency translations/synonyms mapping
  const syns: Record<string, string[]> = {
    "差利·卓别灵": ["查理·卓别林", "卓别林", "Charlie Chaplin"],
    "夏绿蒂·勃朗特": ["夏洛特·勃朗特", "勃朗特", "Charlotte Bronte"],
    "玛丽亚·蒙特梭利": ["玛丽亚·蒙台梭利", "蒙台梭利", "Maria Montessori"],
    "芙烈达·卡罗": ["弗里达·卡洛", "卡洛", "Frida Kahlo"],
    "释弘一": ["弘一法师", "李叔同", "弘一"],
    "乾隆帝": ["乾隆", "Qianlong Emperor"],
    "亚历山大·德·布哈奈": ["亚历山大·德·博阿尔内", "博阿尔内", "Alexandre de Beauharnais"],
    "乔治·雅各布·格甚温": ["乔治·格什温", "格什温", "George Gershwin"],
    "乔治·雅各布·格什温": ["乔治·格什温", "格什温", "George Gershwin"],
    "理查德·菲利普斯·费曼": ["理查德·费曼", "费曼", "Richard Feynman"]
  };

  for (const [key, list] of Object.entries(syns)) {
    if (rawClean.includes(key) || key.includes(rawClean) || cleanTrailing.includes(key)) {
      list.forEach(v => {
        terms.push(sify(v));
      });
    }
  }

  // 6. Handle middle name split for western transliterations
  if (cleanTrailing.includes("·")) {
    const parts = cleanTrailing.split("·").map(p => p.trim());
    if (parts.length >= 3) {
      terms.push(sify(`${parts[0]}·${parts[parts.length - 1]}`));
      terms.push(sify(parts[parts.length - 1]));
    }
    if (parts.length >= 2) {
      terms.push(sify(parts[parts.length - 1]));
      terms.push(sify(parts[0]));
    }
  }

  const uniqueTerms = Array.from(new Set(terms.map(t => t.trim()).filter(Boolean)));
  return uniqueTerms;
}

async function fetchWikidataId(name: string): Promise<string | null> {
    const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
    const queryTerms = generateWikidataSearchTerms(name);
    
    for (const q of queryTerms) {
        try {
            const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=zh&format=json`, { headers });
            if (!res.ok) continue;
            const data = await res.json() as any;
            const entity = data.search?.[0];
            if (entity) {
                console.log(`[Wiki API] [exploreStep] Successfully resolved "${name}" via robust term "${q}" -> ${entity.id}`);
                return entity.id;
            }
        } catch (e) {
            // silent catch on retry
        }
    }
    
    // English fallback with cleaned term
    const cleanEng = name.replace(/[·\-\s\.]+$/, "").trim();
    if (cleanEng && cleanEng !== name) {
        try {
            const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanEng)}&language=en&format=json`, { headers });
            if (res.ok) {
                const data = await res.json() as any;
                const entity = data.search?.[0];
                if (entity) {
                    console.log(`[Wiki API] [exploreStep] Successfully resolved "${name}" via English fallback "${cleanEng}" -> ${entity.id}`);
                    return entity.id;
                }
            }
        } catch (e) {}
    }
    
    return null;
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
    const originalName = finalName;

    // Check main target against forbidden criteria (political/living)
    const checkTarget = checkForbiddenBack(finalName, wikiMeta?.description, personData.lifespan, personData.biography);
    if (checkTarget.forbidden) {
        if (addLog) addLog(`落库校验熔断: ${checkTarget.reason}`, "error");
        throw new Error(checkTarget.reason || "触碰中国近代政治家或在世当代名人限制。");
    }

    if (personData.relationships && Array.isArray(personData.relationships)) {
        personData.relationships = personData.relationships
            .map((rel: any) => ({
                ...rel,
                personName: sify((rel.personName || "").trim())
            }))
            .filter((rel: any) => {
                const name = rel.personName;
                if (!name || name.length < 2) return false;
                if (isCommonForbiddenName(name)) {
                    console.log(`[Validation Check] 过滤掉禁用关联人物: ${name}`);
                    if (addLog) addLog(`过滤掉禁用关联人物: ${name}`, "info");
                    return false;
                }
                return true;
            });
    }

    const portraitUrlRaw = wikiMeta?.imageUrl;
    const portraitUrl = portraitUrlRaw ? portraitUrlRaw : "no_photo";
    
    // Resolve Wikidata ID for the person
    let wikidataId = wikiMeta?.wikidataId || null;
    if (!wikidataId) {
        wikidataId = await fetchWikidataId(finalName);
    }
    if (!wikidataId) {
        throw new Error("未匹配到 Wikidata ID (无法对齐)");
    }

    // Check if exists either by normalized name or match by Wikidata ID (synonyms)
    let existing = await db.prepare("SELECT id, name FROM people WHERE name = ? COLLATE NOCASE").get(finalName) as any;
    if (!existing && wikidataId) {
        const matchedByWiki = await db.prepare("SELECT id, name FROM people WHERE wikidata_id = ?").get(wikidataId) as any;
        if (matchedByWiki) {
            existing = matchedByWiki;
            finalName = matchedByWiki.name; // Keep existing standard name to trigger update and prevent duplicate
        }
    }
    const isUpdate = !!existing;

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
                   OR LOWER(json_extract(value, '$.personName')) = LOWER(?)
              )
        `).all(newId, finalName, originalName) as any[];
        for (const p of previousMentions) {
            try {
                const rels = JSON.parse(p.raw_relationships || "[]");
                const matchingRel = rels.find((r: any) => 
                    r.personName && (
                        r.personName.toLowerCase() === finalName.toLowerCase() || 
                        r.personName.toLowerCase() === originalName.toLowerCase()
                    )
                );
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
