import { DatabaseAdapter } from "./db.ts";
import { ExploreState } from "./exploreTask.ts";
import { FIGURE_POOL } from "./figuresPool.ts";

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
    phase: "init",
    target,
    source: source || 'explorer',
    taskId: providedTaskId || Date.now(),
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

export async function advanceExplorationStep(
  db: DatabaseAdapter,
  callAI: any,
  getConfig: any,
  setConfig: any,
  addRelationship: any,
  ARCHIVE_CORE_PROMPT: any,
  ARCHIVE_CORE_SCHEMA: any,
  ARCHIVE_EXTRA_PROMPT: any,
  ARCHIVE_EXTRA_SCHEMA: any,
  fetchMetadataFromWiki: any,
  c: any,
  isAdmin: boolean
): Promise<ExploreState> {
    const stateRaw = await getConfig(db, "explore_state", "null");
    if (stateRaw === "null") return { status: "error", error: "未找到任务状态" } as any;
    
    let state: ExploreState = JSON.parse(stateRaw);
    if (state.status !== "running") return state; // Already finished

    const saveState = async (updates: Partial<ExploreState>) => {
        state = { ...state, ...updates, lastHeartbeat: Date.now(), pulse: (state.pulse || 0) + 1 };
        await setConfig(db, "explore_state", JSON.stringify(state));
    };

    const addLog = (msg: string, type: string = "ui", data?: any) => {
        const timestamp = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        state.logs.push({ timestamp, msg, type, data });
        if (state.logs.length > 150) state.logs = state.logs.slice(-150);
        db.prepare("INSERT INTO task_logs (task_id, type, msg, data) VALUES (?, ?, ?, ?)").run(String(state.taskId), type, msg, data ? JSON.stringify(data) : null).catch(()=>console.log("log error"));
    };

    const updateLastStep = (status: "success" | "error" | "pending", msg?: string) => {
        if (state.steps.length > 0) {
            const last = state.steps[state.steps.length - 1];
            last.status = status;
            if (msg) last.msg = msg;
        }
    };
    const addStep = (msg: string) => {
        state.steps.push({ msg, status: "pending", startTime: Date.now() });
    };

    try {
        if (state.phase === "init") {
            let finalTargetName = state.target;

            if (!finalTargetName) {
                addLog("[SYSTEM] 扫描被触发 - 目标随机...", "info");
                const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 20").all() as any[];
                state.sampleNames = samplePeople.map((p: any) => p.name).join("、");
                const existingSet = new Set(samplePeople.map((p: any) => p.name));
                const CATEGORIES = ["哲学家","艺术家","科学家/数学家","发明家","政治家/君主","军事家","思想家/教育家","文学家/作家","诗人","音乐家/作曲家","歌手/演艺明星","探险家/航海家","商业精英/企业家","医学家","其他历史名人"];
                
                const unarchivedInPool: string[] = [];
                for (const cat of CATEGORIES) {
                    FIGURE_POOL[cat]?.forEach(n => { if (!existingSet.has(n)) unarchivedInPool.push(n); });
                }

                if (unarchivedInPool.length > 0) {
                    finalTargetName = unarchivedInPool[Math.floor(Math.random() * unarchivedInPool.length)];
                } else {
                    const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。要求不包含在已知列表中：[${state.sampleNames} ...]`;
                    const resultText = await callAI(c, db, prompt, "text");
                    finalTargetName = (resultText || "").trim().replace(/[「」""'']/g, "");
                }
            }
            
            updateLastStep("success", `锁定目标: ${finalTargetName}`);
            addStep(`探索检索：正在寻找 ${finalTargetName} 的特征...`);
            
            const wikiMeta = await fetchMetadataFromWiki(finalTargetName);
            if (!wikiMeta || !wikiMeta.imageUrl) {
                throw new Error(`全网检索失败：未能在数据库中找到 ${finalTargetName} 的有效标准化档案或肖像照片，已中止任务以确保档案品质。`);
            }
            if (wikiMeta.description) addLog(`[WIKI] 匹配身份线索: ${wikiMeta.description.substring(0, 100)}`, "info");
            
            await saveState({ target: wikiMeta.normalizedName, wikiMeta, phase: "ai_core" });
            return state;
        }

        if (state.phase === "ai_core") {
            updateLastStep("success", `特征提取成功: ${state.target}`);
            addStep(`深度分析：AI 正在构建 ${state.target} 的核心时空档案...`);
            
            const CATEGORIES = ["哲学家", "艺术家", "科学家/数学家", "发明家", "政治家/君主", "军事家", "思想家/教育家", "文学家/作家", "诗人", "音乐家/作曲家", "歌手/演艺明星", "探险家/航海家", "商业精英/企业家", "医学家", "其他历史名人"];
            const prompt = ARCHIVE_CORE_PROMPT(state.target, CATEGORIES, state.sampleNames || "", state.wikiMeta.description);
            let resultText = "";
            try {
                resultText = await callAI(c, db, prompt, "json", ARCHIVE_CORE_SCHEMA(!!state.wikiMeta.description));
            } catch (e: any) { throw new Error(e.message.includes("超时") ? "AI 探索思考时间过长" : e.message); }

            let coreData: any = {};
            try {
                const sanitized = (resultText || "{}").replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' ');
                coreData = JSON.parse(sanitized);
            } catch (e) { throw new Error(`AI 生成人物数据格式有误`); }
            
            if (Array.isArray(coreData)) coreData = coreData[0];
            if (!coreData.biography && coreData.result) coreData = coreData.result;
            if (!coreData || (!coreData.standardChineseName && !coreData.biography)) throw new Error(`AI 返回空数据`);
            
            if (!isAdmin && !state.wikiMeta.description && coreData.accepted === false) {
                 throw new Error(`抱歉，${state.target} 可能不符合入库标准`);
            }
            
            await saveState({ coreData, phase: "ai_extra", target: coreData.standardChineseName || state.target });
            return state;
        }

        if (state.phase === "ai_extra") {
            addStep(`提取成就及编织时空关联网...`);
            const extraPrompt = ARCHIVE_EXTRA_PROMPT(state.target, state.coreData.biography);
            let extraResultText = "";
            try {
                extraResultText = await callAI(c, db, extraPrompt, "json", ARCHIVE_EXTRA_SCHEMA);
            } catch (e: any) { throw new Error(e.message); }
            
            let extraData: any = {};
            try { extraData = JSON.parse((extraResultText || "{}").replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' ')); } catch (e) {}
            if (Array.isArray(extraData)) extraData = extraData[0];
            
            await saveState({ extraData, phase: "finalize" });
            return state;
        }

        if (state.phase === "finalize") {
            const personData = { ...state.coreData, ...state.extraData };
            const finalName = state.target;
            
            const portraitUrlRaw = state.wikiMeta.imageUrl;
            const portraitUrl = `/api/portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`;
            if (c.env && c.env.IMAGES && portraitUrlRaw) {
                try {
                    const imgRes = await fetch(portraitUrlRaw);
                    if (imgRes.ok) {
                        const buffer = await imgRes.arrayBuffer();
                        await c.env.IMAGES.put(`portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`, buffer, {
                            httpMetadata: { contentType: imgRes.headers.get("content-type") || "image/jpeg" }
                        });
                        addLog(`肖像同步成功`, "success");
                    }
                } catch(e) {}
            }
            
            const res = await db.prepare(
                `INSERT INTO people (name, category, keyword, biography, achievements, raw_relationships, lifespan, birthplace, latitude, longitude, image_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(name) DO UPDATE SET 
                   category=excluded.category, keyword=excluded.keyword, biography=excluded.biography, image_url=excluded.image_url,
                   achievements=excluded.achievements, raw_relationships=excluded.raw_relationships, lifespan=excluded.lifespan, birthplace=excluded.birthplace,
                   latitude=excluded.latitude, longitude=excluded.longitude RETURNING id`
            ).get(finalName, personData.category || "未知", personData.keyword || "", personData.biography || "", JSON.stringify(personData.achievements || []), JSON.stringify(personData.relationships || []), personData.lifespan || "", personData.birthplace || "", personData.latitude || 0, personData.longitude || 0, portraitUrl);
            
            let newId = (res as any)?.id;
            if (!newId) newId = (await db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(finalName) as any)?.id;
            
            if (newId) {
                if (personData.relationships) {
                    for (const rel of personData.relationships) {
                        const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
                        if (matched) await addRelationship(db, newId, matched.id, rel.relationshipType);
                    }
                }
                const previousMentions = await db.prepare(`SELECT id, name, raw_relationships FROM people WHERE id != ? AND raw_relationships LIKE ?`).all(newId, `%${finalName}%`) as any[];
                for (const p of previousMentions) {
                    try {
                        const rels = JSON.parse(p.raw_relationships || "[]");
                        const matchingRel = rels.find((r: any) => r.personName === finalName);
                        if (matchingRel) await addRelationship(db, p.id, newId, matchingRel.relationshipType);
                    } catch(e) {}
                }
            }
            
            updateLastStep("success", `时空节点建立成功：${finalName}`);
            addLog(`入库协议执行完毕：${finalName} 已正式载入史册`, "success");
            await saveState({ status: "success", target: finalName, newArrivals: [...state.newArrivals, finalName], path: [{ name: finalName, type: "入库成功" }] });
            return state;
        }
    } catch (e: any) {
        updateLastStep("error", `执行错误: ${e.message}`);
        addLog(`探索中止: ${e.message}`, "error");
        await saveState({ status: "error", error: e.message });
        return state;
    }
    
    return state;
}
