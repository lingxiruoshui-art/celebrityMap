import { DatabaseAdapter } from "./db.ts";

export interface ExploreState {
  status: "idle" | "running" | "success" | "error";
  lastHeartbeat?: number;
  pulse?: number;
  source: string;
  target: string;
  logs: { timestamp: string; msg: string; type: string; data?: any }[];
  steps: { msg: string; status: string; startTime?: number }[];
  path: any[] | null;
  newArrivals: string[];
  error: string | null;
}

export async function runExplorationTask(
  db: DatabaseAdapter,
  source: string,
  target: string,
  callAI: any,
  getConfig: any,
  setConfig: any,
  addRelationship: any,
  ARCHIVE_PROMPT: any,
  ARCHIVE_SCHEMA: any,
  PATH_PROMPT: any,
  PATH_SCHEMA: any,
  VALIDATION_PROMPT: any,
  VALIDATION_SCHEMA: any,
  c: any,
  isAdmin: boolean,
  onPulse?: (msg: string) => Promise<void>
) {
  let state: ExploreState = {
    status: "running",
    source,
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
    // Check if aborted or reset by user
    let currentRaw = "null";
    if (c.env && c.env.EXPLORE_KV) {
        currentRaw = await c.env.EXPLORE_KV.get("explore_state") || "null";
    } else {
        currentRaw = await getConfig(db, "explore_state", "null");
    }
    
    if (currentRaw === "null") {
        // State was cleared (reset), stop this task
        throw new Error("AbortError");
    }

    const current = JSON.parse(currentRaw);
    if (current.status === "error" && current.error === "探索已中止") {
        throw new Error("AbortError");
    }
    
    // Check if it is a different task (different source/target)
    if (current.status === 'running' && (current.source !== state.source || current.target !== state.target)) {
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
    // Keep logs lean to prevent massive state objects
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
    addLog("启动时空探索协议会话", "api", {
      source,
      target,
      timestamp: new Date().toISOString(),
    });
    addStep("正在初始化跨时空检索协议...");
    await saveState();

    addLog("请求馆藏核心元数据", "api");
    const peopleCountRow = await db.prepare("SELECT COUNT(*) as count FROM people").get() as { count: number };
    const peopleCount = peopleCountRow.count;
    
    state.lastHeartbeat = Date.now();
    // 随机抽取少量样本作为 AI 提示词参考，避免随着数据增加导致 Prompt 过长
    const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 8").all() as any[];
    const sampleNames = samplePeople.map((p) => p.name).join("、");

    const provider = await getConfig(db, "active_model_provider", "gemini");
    const modelId =
      provider === "gemini"
        ? await getConfig(db, "gemini_model_id")
        : await getConfig(db, "aliyun_model_id");

    if (!modelId) {
      throw new Error(
        `请先在后台配置 ${provider === "gemini" ? "Gemini" : "Aliyun"} 模型 ID`,
      );
    }
    updateLastStep("success");

    addStep(`正在识别人物身份: ${source} 与 ${target}...`);
    await saveState();

    const callAIProxy = async (
      prompt: string,
      responseFormat: "text" | "json" = "json",
      schema?: any,
      timeoutMs: number = 120000,
      skipImmediateSave: boolean = false
    ) => {
      addLog(`AI 代理请求发送`, "ai-req", { prompt, responseFormat, schema });
      if (!skipImmediateSave) await saveState();
      try {
        let text: string;
        if (timeoutMs) {
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("请求超时")), timeoutMs);
          });
          text = await Promise.race([
            callAI(c, db, prompt, responseFormat, schema, async () => {
              await saveState("AI推理维持心跳");
            }),
            timeoutPromise
          ]);
        } else {
          text = await callAI(c, db, prompt, responseFormat, schema, async () => {
              await saveState("AI推理维持心跳");
          });
        }
        addLog("AI 响应解码成功", "ai-res", { rawText: text.substring(0, 100) + "..." });
        return text;
      } catch (e: any) {
        addLog("AI 服务响应失败", "error", e.message);
        throw new Error(e.message === "请求超时" ? "AI 探索思考时间过长，已中断" : (e.message || "AI 服务异常"));
      }
    };

    const missingValidationNames: string[] = [];
    const srcInDb = (await db.prepare("SELECT name FROM people WHERE name = ?").get(source)) as any;
    if (!srcInDb) missingValidationNames.push(source);
    
    const tgtInDb = (await db.prepare("SELECT name FROM people WHERE name = ?").get(target)) as any;
    if (!tgtInDb && source !== target) missingValidationNames.push(target);

    let srcValid: any = { accepted: true, normalizedName: srcInDb?.name || source };
    let tgtValid: any = { accepted: true, normalizedName: tgtInDb?.name || target };

    if (missingValidationNames.length > 0) {
      const text = await callAIProxy(
        VALIDATION_PROMPT(missingValidationNames, sampleNames),
        "json",
        VALIDATION_SCHEMA,
        120000
      );
      let parsed: any = {};
      try {
        let rawParsed = JSON.parse(text || "{}");
        parsed = rawParsed;
      } catch (e) {
        throw new Error("AI 响应解析失败");
      }
      
      let results = [];
      if (parsed.results) {
          results = parsed.results;
      } else if (parsed.result && parsed.result.results) {
          results = parsed.result.results;
      } else if (Array.isArray(parsed)) {
          results = parsed;
      }

      if (results && results.length > 0) {
        for (let i = 0; i < results.length; i++) {
          const res = results[i];
          const queryName = i < missingValidationNames.length ? missingValidationNames[i] : (res.name || "");
          
          if (res.name === source || queryName === source || (source.includes(res.name) && res.name.length > 1)) srcValid = res;
          else if (res.name === target || queryName === target || (target.includes(res.name) && res.name.length > 1)) tgtValid = res;
        }
      } else {
        throw new Error("系统未能识别该人物");
      }
    }

    if (!srcValid.accepted)
      throw new Error(`起点人物无效: ${srcValid.reason || "原因未知"}`);
    if (!tgtValid.accepted)
      throw new Error(`终点人物无效: ${tgtValid.reason || "原因未知"}`);

    const normalizedSource = srcValid.normalizedName || source;
    const normalizedTarget = tgtValid.normalizedName || target;
    state.source = normalizedSource;
    state.target = normalizedTarget;
    updateLastStep(
      "success",
      `识别成功: ${normalizedSource} 与 ${normalizedTarget}`,
    );
    addStep("正在同步时空档案索引...");
    await saveState();

    // Optimize: Load metadata separately to avoid heavy joins
    const peopleData = await db.prepare("SELECT id, name FROM people").all() as { id: number, name: string }[];
    const idToName = new Map<number, string>();
    const nameToId = new Map<string, number>();
    for (const p of peopleData) {
      idToName.set(p.id, p.name);
      nameToId.set(p.name, p.id);
    }

    const allRels = await db.prepare("SELECT person1_id, person2_id, relationship_type as type FROM relationships").all() as any[];
    
    updateLastStep("success", `已同步 ${peopleData.length} 位人物与 ${allRels.length} 条时空连接`);
    addStep("正在通过现有索引进行 BFS 路径拓扑扫描...");
    await saveState();
    
    const adj = new Map<number, { targetId: number, type: string }[]>();
    for (const r of allRels) {
      if (!adj.has(r.person1_id)) adj.set(r.person1_id, []);
      if (!adj.has(r.person2_id)) adj.set(r.person2_id, []);
      adj.get(r.person1_id)!.push({ targetId: r.person2_id, type: r.type });
      adj.get(r.person2_id)!.push({ targetId: r.person1_id, type: r.type });
    }

    const startId = nameToId.get(normalizedSource);
    const endId = nameToId.get(normalizedTarget);

    let directPath = null;
    if (startId !== undefined && endId !== undefined) {
      let q = [{ id: startId, path: [{ name: normalizedSource }] as any[] }];
      let visited = new Set([startId]);
      let limit = 1000;
      let head = 0;
      
      while (head < q.length && limit-- > 0) {
        let curr = q[head++];
        if (curr.id === endId) {
          directPath = curr.path;
          break;
        }
        const neighbors = adj.get(curr.id) || [];
        for (let n of neighbors) {
          if (!visited.has(n.targetId)) {
            visited.add(n.targetId);
            q.push({
              id: n.targetId,
              path: [...curr.path, { name: idToName.get(n.targetId)!, type: n.type }],
            });
          }
        }
      }
    }

    if (directPath) {
      updateLastStep("success", "在现有馆藏中找到直接路径！");
      state.path = directPath;
      state.status = "success";
      await saveState();
      return;
    }

    updateLastStep("success", "现有馆藏中无直接路径，启动 AI 逻辑推理...");
    addStep("AI 专家正在解析时空引力场...");
    await saveState();

    const bridgeStartTime = Date.now();
    const bridgeText = await callAIProxy(
      PATH_PROMPT(normalizedSource, normalizedTarget),
      "json",
      PATH_SCHEMA,
      undefined, // Default timeout or use specific
      false
    );
    
    const bridgeDuration = Math.round((Date.now() - bridgeStartTime) / 1000);
    addLog(`已获取 AI 连通路径 (耗时: ${bridgeDuration}s)`, "info", { result: bridgeText });
    updateLastStep("success", `AI 已打通时空链路 (耗时 ${bridgeDuration}s)`);
    addStep("正在反向验证并加固路径节点...");
    await saveState();
    let bridgeData: any = { chain: [] };
    try {
      let rawBridge = JSON.parse(bridgeText || "{}");
      bridgeData =
        Array.isArray(rawBridge) && rawBridge.length > 0
          ? rawBridge[0]
          : rawBridge;
    } catch (e) {
      throw new Error("AI 返回了无法解析的关系数据，请稍后重试。");
    }

    let chain =
      bridgeData.chain || (bridgeData.result && bridgeData.result.chain) || [];
    if (chain.length < 2)
      throw new Error("AI 未能建立有效联系，请尝试更换人物或重新搜索。");
    updateLastStep("success");
    await saveState();

    const finalPath: any[] = [];
    const categories = [
      "哲学家",
      "艺术家",
      "科学家/数学家",
      "发明家",
      "政治家/君主",
      "军事家",
      "思想家/教育家",
      "文学家/作家",
      "诗人",
      "音乐家/作曲家",
      "歌手/演艺明星",
      "探险家/航海家",
      "商业精英/企业家",
      "医学家",
      "其他历史名人",
    ];
    const missingNames = [];
    for (const step of chain) {
      if (!step.name) continue;
      const p = (await db
        .prepare("SELECT id FROM people WHERE name = ?")
        .get(step.name)) as any;
      if (!p) missingNames.push(step.name);
    }

    if (missingNames.length > 0) {
      for (const name of missingNames) {
        addStep(`正在获取「${name}」的历史资料...`);
        await saveState();

        const archiveText = await callAIProxy(
          ARCHIVE_PROMPT(name, categories, sampleNames),
          "json",
          ARCHIVE_SCHEMA,
          120000,
          true // skipImmediateSave
        );
        let personData: any = {};
        try {
          let rawPerson = JSON.parse(archiveText || "{}");
          personData =
            Array.isArray(rawPerson) && rawPerson.length > 0
              ? rawPerson[0]
              : rawPerson;
        } catch (e) {
          throw new Error(`AI 生成人物 ${name} 的传记无法解析`);
        }
        if (!personData.biography && personData.result)
          personData = personData.result;

        const res = await db
          .prepare(
            `
               INSERT INTO people (name, category, keyword, biography, achievements, raw_relationships, lifespan, birthplace, latitude, longitude)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET keyword=excluded.keyword, biography=excluded.biography
               RETURNING id
            `,
          )
          .get(
            name,
            personData.category || "未知",
            personData.keyword || "",
            personData.biography || "",
            JSON.stringify(personData.achievements || []),
            JSON.stringify(personData.relationships || []),
            personData.lifespan || "",
            personData.birthplace || "",
            personData.latitude || 0,
            personData.longitude || 0,
          );
        
        // Update local maps for the next steps
        let newId = (res as any)?.id;
        if (!newId) {
            const getRes = await db.prepare("SELECT id FROM people WHERE name = ? COLLATE NOCASE").get(name) as any;
            newId = getRes?.id;
        }
        if (newId) {
            nameToId.set(name, Number(newId));
        }
        state.newArrivals.push(name);
        updateLastStep("success", `成功同步「${name}」`);
        await saveState();
      }
    }

    for (let i = 0; i < chain.length; i++) {
        const step = chain[i];
        if (!step.name) continue;

        if (i > 0) {
          const p1Id = nameToId.get(chain[i - 1].name);
          const p2Id = nameToId.get(step.name);
          if (p1Id && p2Id) {
            await addRelationship(db, p1Id, p2Id, step.relationshipToPrevious);
          }
        }
        finalPath.push({ name: step.name, type: step.relationshipToPrevious });
    }
    
    state.path = finalPath;
    state.status = "success";
    await saveState();

    if (!isAdmin) {
      const date = new Date(new Date().getTime() + 8 * 3600 * 1000)
        .toISOString()
        .split("T")[0];
      await db
        .prepare(
          `INSERT INTO guest_usage (ip, date, count) VALUES ('GLOBAL_GUEST', ?, 1) ON CONFLICT(ip, date) DO UPDATE SET count = count + 1`,
        )
        .run(date);
    }
  } catch (e: any) {
    if (e.message === "AbortError") return;
    state.status = "error";
    state.error = e.message;
    try {
      await saveState();
    } catch (saveErr) {
      console.error("Failed to save error state:", saveErr);
    }
  }
}
