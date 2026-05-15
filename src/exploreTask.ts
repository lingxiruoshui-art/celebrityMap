import { DatabaseAdapter } from "./db.ts";
import { FIGURE_POOL } from "./figuresPool.ts";

export interface ExploreState {
  status: "idle" | "running" | "success" | "error";
  lastHeartbeat?: number;
  pulse?: number;
  target: string;
  logs: { timestamp: string; msg: string; type: string; data?: any }[];
  steps: { msg: string; status: string; startTime?: number }[];
  path: any[] | null;
  newArrivals: string[];
  error: string | null;
}

export async function runExplorationTask(
  db: DatabaseAdapter,
  target: string,
  callAI: any,
  getConfig: any,
  setConfig: any,
  addRelationship: any,
  ARCHIVE_PROMPT: any,
  ARCHIVE_SCHEMA: any,
  fetchMetadataFromWiki: any,
  c: any,
  isAdmin: boolean,
  onPulse?: (msg: string) => Promise<void>
) {
  let state: ExploreState = {
    status: "running",
    target,
    pulse: 0,
    logs: [],
    steps: [],
    path: null,
    error: null,
    newArrivals: [],
  };

  const saveState = async (reason?: string) => {
    state.lastHeartbeat = Date.now();
    state.pulse = (state.pulse || 0) + 1;
    if (onPulse) {
      await onPulse(reason || "heartbeat");
    }
    
    let currentRaw = "null";
    if (c.env && c.env.EXPLORE_KV) {
        currentRaw = await c.env.EXPLORE_KV.get("explore_state") || "null";
    } else {
        currentRaw = await getConfig(db, "explore_state", "null");
    }
    
    if (currentRaw === "null") {
        throw new Error("AbortError");
    }

    const current = JSON.parse(currentRaw);
    if (current.status === "error" && current.error === "探索已中止") {
        throw new Error("AbortError");
    }
    
    if (current.status === 'running' && current.target !== state.target) {
        throw new Error("AbortError");
    }

    const stateStr = JSON.stringify(state);
    try {
        if (c.env && c.env.EXPLORE_KV) {
            await c.env.EXPLORE_KV.put("explore_state", stateStr);
        } else {
            await setConfig(db, "explore_state", stateStr);
        }
    } catch (kvError) {
        console.error("Failed to save state to KV/Config:", kvError);
    }
  };

  const addLog = (msg: string, type: string = "ui", data?: any) => {
    state.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      msg,
      type,
      data,
    });
    if (state.logs.length > 50) state.logs.shift();
  };

  const addStep = (msg: string) => {
    state.steps.push({ msg, status: "pending", startTime: Date.now() });
    if (state.steps.length > 20) state.steps.shift();
  };

  const updateLastStep = (
    status: "success" | "error" | "pending",
    msg?: string,
  ) => {
    if (state.steps.length > 0) {
      const last = state.steps[state.steps.length - 1];
      last.status = status;
      if (msg) last.msg = msg;
      if (status === "error") addLog(`步骤失败: ${msg || last.msg}`, "error");
    }
  };

  try {
    addLog("启动时空档案入库协议", "api", {
      target,
      timestamp: new Date().toISOString(),
    });
    addStep("正在初始化跨时空检索协议...");
    await saveState();

    const provider = await getConfig(db, "active_model_provider", "gemini");
    const modelId =
      provider === "gemini"
        ? await getConfig(db, "gemini_model_id")
        : await getConfig(db, "aliyun_model_id");

    if (!modelId) {
      throw new Error(`请先在后台配置 ${provider === "gemini" ? "Gemini" : "Aliyun"} 模型 ID`);
    }

    // Prepare samples for diversity
    const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 20").all() as any[];
    const sampleNames = samplePeople.map((p: any) => p.name).join("、");

    let finalTargetName = target;

    // AI random selection if no target is specified
    if (!finalTargetName) {
        addStep("图谱自动推演：寻找值得探索的新人物...");
        await saveState();

        const existingSet = new Set(samplePeople.map((p: any) => p.name));
        const unarchivedInPool: string[] = [];
        const CATEGORIES = ["哲学家","艺术家","科学家/数学家","发明家","政治家/君主","军事家","思想家/教育家","文学家/作家","诗人","音乐家/作曲家","歌手/演艺明星","探险家/航海家","商业精英/企业家","医学家","其他历史名人"];
        for (const cat of CATEGORIES) {
            FIGURE_POOL[cat]?.forEach(n => { if (!existingSet.has(n)) unarchivedInPool.push(n); });
        }
        
        if (unarchivedInPool.length > 0) {
            finalTargetName = unarchivedInPool[Math.floor(Math.random() * unarchivedInPool.length)];
            addLog(`从预设池中随机选中: ${finalTargetName}`, "info");
        } else {
            addLog("预设池已满，正在进行 AI 随机发散...", "info");
            const prompt = `请从世界历史中选取一位极其著名、具有重大全球影响力且通常被视为正面的真实历史人物。要求不包含在已知列表中：[${sampleNames} ...]`;
            const resultText = await callAI(c, db, prompt, "text");
            finalTargetName = (resultText || "").trim().replace(/[「」""'']/g, "");
            addLog(`AI 随机发散选中: ${finalTargetName}`, "info");
        }
    }

    state.target = finalTargetName;
    updateLastStep("success", `锁定目标: ${finalTargetName}`);
    addStep(`正在从 Wikidata/Wikipedia 唤醒 ${finalTargetName} 的记忆...`);
    await saveState();

    const meta = await fetchMetadataFromWiki(finalTargetName);
    finalTargetName = meta.normalizedName;
    state.target = finalTargetName;

    updateLastStep("success", `确定抓取目标: ${finalTargetName}`);
    if (meta.description) {
        addLog(`识别到身份线索: ${meta.description}`, "info");
    }

    addStep(`正在利用 AI 深度检索并编织 ${finalTargetName} 的历史时空数据...`);
    await saveState();

    const CATEGORIES = [
      "哲学家", "艺术家", "科学家/数学家", "发明家", "政治家/君主",
      "军事家", "思想家/教育家", "文学家/作家", "诗人", "音乐家/作曲家",
      "歌手/演艺明星", "探险家/航海家", "商业精英/企业家", "医学家", "其他历史名人"
    ];

    const prompt = ARCHIVE_PROMPT(finalTargetName, CATEGORIES, sampleNames, meta.description);

    addLog(`AI 代理请求发送`, "ai-req", { prompt_snippet: prompt.substring(0, 300) + "..." });
    let resultText: string;
    try {
        resultText = await callAI(c, db, prompt, "json", ARCHIVE_SCHEMA, async () => {
            await saveState("AI 仍在思考中...");
        });
    } catch (e: any) {
        throw new Error(e.message === "请求超时" ? "AI 探索思考时间过长，已中断" : (e.message || "AI 服务异常"));
    }

    addLog("AI 响应解码成功", "ai-res", { rawTextSnippet: resultText.substring(0, 200) + "..." });

    let personData: any = {};
    try {
        personData = JSON.parse(resultText || "{}");
        if (Array.isArray(personData) && personData.length > 0) personData = personData[0];
        if (!personData.biography && personData.result) personData = personData.result;
    } catch (e) {
        throw new Error(`AI 生成人物 ${finalTargetName} 的传记无法解析`);
    }

    if (!personData.accepted && !isAdmin) {
        throw new Error(`抱歉，${finalTargetName} 可能不符合入库标准（${personData.reason || "非真实历史人物"}）`);
    }

    const finalName = personData.standardChineseName || finalTargetName;
    state.target = finalName;
    updateLastStep("success", `数据已萃取，人物标准名: ${finalName}`);
    
    addStep(`提取并生成 ${finalName} 的历史肖像...`);
    await saveState();

    const portraitUrlRaw = meta.imageUrl || `https://image.pollinations.ai/prompt/${encodeURIComponent("Historical portrait of " + finalName + ", realistic oil painting style, highly detailed")}`;
    const portraitUrl = `/api/portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`;

    if (c.env && c.env.IMAGES && portraitUrlRaw) {
        try {
          const imgRes = await fetch(portraitUrlRaw);
          if (imgRes.ok) {
              const buffer = await imgRes.arrayBuffer();
              await c.env.IMAGES.put(`portraits/${encodeURIComponent(finalName.toLowerCase())}.jpg`, buffer, {
                  httpMetadata: { contentType: imgRes.headers.get("content-type") || "image/jpeg" }
              });
          }
        } catch(e) {
           console.warn("Failed to cache image:", e);
        }
    }

    updateLastStep("success", "肖像获取完成");
    addStep(`归档处理：将 ${finalName} 接入时空连续体...`);
    await saveState();

    const res = await db
      .prepare(
        `
           INSERT INTO people (name, category, keyword, biography, achievements, raw_relationships, lifespan, birthplace, latitude, longitude, image_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET 
             category=excluded.category, keyword=excluded.keyword, biography=excluded.biography, image_url=excluded.image_url,
             achievements=excluded.achievements, raw_relationships=excluded.raw_relationships, lifespan=excluded.lifespan, birthplace=excluded.birthplace,
             latitude=excluded.latitude, longitude=excluded.longitude
           RETURNING id
        `,
      )
      .get(
        finalName,
        personData.category || "未知",
        personData.keyword || "",
        personData.biography || "",
        JSON.stringify(personData.achievements || []),
        JSON.stringify(personData.relationships || []),
        personData.lifespan || "",
        personData.birthplace || "",
        personData.latitude || 0,
        personData.longitude || 0,
        portraitUrl
      );
    
    let newId = (res as any)?.id;
    if (!newId) {
        const getRes = await db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(finalName) as any;
        newId = getRes?.id;
    }

    if (newId) {
        // 1. 主动连接
        if (personData.relationships && Array.isArray(personData.relationships)) {
            for (const rel of personData.relationships) {
                const matched = await db.prepare("SELECT id FROM people WHERE name = ?").get(rel.personName) as any;
                if (matched) {
                    await addRelationship(db, newId, matched.id, rel.relationshipType);
                }
            }
        }

        // 2. 被动追溯
        const previousMentions = await db.prepare(`SELECT id, name, raw_relationships FROM people WHERE id != ? AND (raw_relationships LIKE ? OR raw_relationships LIKE ?)`).all(newId, `%${finalName}%`, `%${target}%`) as any[];
        for (const p of previousMentions) {
            try {
                const rels = JSON.parse(p.raw_relationships || "[]");
                const matchingRel = rels.find((r: any) => r.personName === finalName || r.personName === target);
                if (matchingRel) {
                    await addRelationship(db, p.id, newId, matchingRel.relationshipType);
                }
            } catch(e) {}
        }
    }
    
    state.newArrivals.push(finalName);
    updateLastStep("success", `时空节点建立成功：${finalName}`);
    
    state.status = "success";
    state.path = [{ name: finalName, type: "入库成功" }];
    await saveState();

  } catch (e: any) {
    if (e.message === "AbortError") return;
    state.status = "error";
    state.error = e.message;
    
    // Add logs so the UI can properly surface the issue instead of silently failing
    updateLastStep("error", `执行错误: ${e.message}`);
    addLog(`执行过程发生错误: ${e.message}`, "error", { message: e.message, stack: e.stack });

    try {
      await saveState();
    } catch (saveErr) {
      console.error("Failed to save error state:", saveErr);
    }
  }
}

