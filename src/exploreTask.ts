import { DatabaseAdapter } from "./db.ts";

export interface ExploreState {
  status: "idle" | "running" | "success" | "error";
  source: string;
  target: string;
  explorerId?: string;
  logs: { timestamp: string; msg: string; type: string; data?: any }[];
  steps: { msg: string; status: string }[];
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
  explorerId?: string,
) {
  let state: ExploreState = {
    status: "running",
    source,
    target,
    explorerId,
    logs: [],
    steps: [],
    path: null,
    error: null,
    newArrivals: [],
  };

  const saveState = async () => {
    // Check if aborted by user
    let currentRaw = "null";
    if (c.env && c.env.EXPLORE_KV) {
        currentRaw = await c.env.EXPLORE_KV.get("explore_state") || "null";
    } else {
        currentRaw = await getConfig(db, "explore_state", "null");
    }
    if (currentRaw !== "null") {
      const current = JSON.parse(currentRaw);
      if (current.status === "error" && current.error === "探索已中止") {
        throw new Error("AbortError");
      }
    }
    const stateStr = JSON.stringify(state);
    if (c.env && c.env.EXPLORE_KV) {
        await c.env.EXPLORE_KV.put("explore_state", stateStr);
    } else {
        await setConfig(db, "explore_state", stateStr);
    }
  };

  const addLog = (msg: string, type: string = "ui", data?: any) => {
    state.logs.push({
      timestamp: new Date().toLocaleTimeString(),
      msg,
      type,
      data,
    });
  };

  const addStep = (msg: string) => {
    state.steps.push({ msg, status: "pending" });
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
    
    // 随机抽取少量样本作为 AI 提示词参考，避免随着数据增加导致 Prompt 过长
    const samplePeople = await db.prepare("SELECT name FROM people ORDER BY RANDOM() LIMIT 20").all() as any[];
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
    ) => {
      addLog(`AI 代理请求发送`, "ai-req", { prompt, responseFormat, schema });
      await saveState();
      try {
        const text = await callAI(c, db, prompt, responseFormat, schema);
        addLog("AI 响应解码成功", "ai-res", { rawText: text });
        return text;
      } catch (e: any) {
        addLog("AI 服务响应失败", "error", e.message);
        throw new Error(e.message || "AI 服务异常");
      }
    };

    const validate = async (name: string) => {
      // 先尝试库内精确匹配，减少 AI 调用
      const p = (await db.prepare("SELECT name FROM people WHERE name = ?").get(name)) as any;
      if (p)
        return {
          accepted: true,
          normalizedName: p.name,
          reason: "馆藏库内已存身份",
        };

      const text = await callAIProxy(
        VALIDATION_PROMPT(name, sampleNames),
        "json",
        VALIDATION_SCHEMA,
      );
      let parsed: any = {};
      try {
        let rawParsed = JSON.parse(text || "{}");
        parsed =
          Array.isArray(rawParsed) && rawParsed.length > 0
            ? rawParsed[0]
            : rawParsed;
      } catch (e) {
        return { accepted: false, reason: "AI 响应解析失败" };
      }
      if (parsed.accepted === undefined) {
        if (parsed.result && parsed.result.accepted !== undefined)
          parsed = parsed.result;
        else return { accepted: false, reason: "系统未能识别该人物" };
      }
      return parsed;
    };

    const [srcValid, tgtValid] = await Promise.all([
      validate(source),
      validate(target),
    ]);
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
    addStep("正在扫描馆藏路径...");
    await saveState();

    // Implement native pathfind logic here
    const getConnections = async (name: string) => {
      const p = (await db
        .prepare("SELECT id FROM people WHERE name = ?")
        .get(name)) as any;
      if (!p) return [];
      const rows = (await db
        .prepare(
          `SELECT p.name as targetName, r.relationship_type as type FROM relationships r JOIN people p ON (r.person2_id = p.id) WHERE r.person1_id = ?`,
        )
        .all(p.id)) as any[];
      const rows2 = (await db
        .prepare(
          `SELECT p.name as targetName, '' as type FROM relationships r JOIN people p ON (r.person1_id = p.id) WHERE r.person2_id = ?`,
        )
        .all(p.id)) as any[];
      return [...rows, ...rows2];
    };

    let directPath = null;
    let q = [
      { name: normalizedSource, path: [{ name: normalizedSource }] as any[] },
    ];
    let visited = new Set([normalizedSource]);
    let limit = 1000;
    while (q.length > 0 && limit-- > 0) {
      let curr = q.shift()!;
      if (curr.name === normalizedTarget) {
        directPath = curr.path;
        break;
      }
      let conns = await getConnections(curr.name);
      for (let c of conns) {
        if (!visited.has(c.targetName)) {
          visited.add(c.targetName);
          q.push({
            name: c.targetName,
            path: [...curr.path, { name: c.targetName, type: c.type }],
          });
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
    addStep("AI 正在编织历史脉络...");
    await saveState();

    const bridgeText = await callAIProxy(
      PATH_PROMPT(normalizedSource, normalizedTarget, sampleNames),
      "json",
      PATH_SCHEMA,
    );
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
    for (let i = 0; i < chain.length; i++) {
      const step = chain[i];
      if (!step.name) continue;
      addStep(`正在处理节点: ${step.name}...`);
      await saveState();

      const p = (await db
        .prepare("SELECT id, biography FROM people WHERE name = ?")
        .get(step.name)) as any;
      if (!p || !p.biography) {
        updateLastStep(
          "pending",
          `正在为新发现的人物 ${step.name} 撰写传记...`,
        );
        await saveState();
        const archiveText = await callAIProxy(
          ARCHIVE_PROMPT(step.name, categories, sampleNames),
          "json",
          ARCHIVE_SCHEMA,
        );
        let personData: any = {};
        try {
          let rawPerson = JSON.parse(archiveText || "{}");
          personData =
            Array.isArray(rawPerson) && rawPerson.length > 0
              ? rawPerson[0]
              : rawPerson;
        } catch (e) {
          throw new Error("AI 生成的人物传记无法解析，探索被中断。");
        }
        if (!personData.biography && personData.result)
          personData = personData.result;

        // Save person
        await db
          .prepare(
            `
               INSERT INTO people (name, category, keyword, biography, achievements, raw_relationships, lifespan, birthplace, latitude, longitude)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(name) DO UPDATE SET keyword=excluded.keyword, biography=excluded.biography
            `,
          )
          .run(
            step.name,
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

        state.newArrivals.push(step.name);
      }

      if (i > 0) {
        let p1 = (await db
          .prepare("SELECT id FROM people WHERE name = ?")
          .get(chain[i - 1].name)) as any;
        let p2 = (await db
          .prepare("SELECT id FROM people WHERE name = ?")
          .get(step.name)) as any;
        if (p1 && p2)
          await addRelationship(db, p1.id, p2.id, step.relationshipToPrevious);
      }

      finalPath.push({ name: step.name, type: step.relationshipToPrevious });
      state.path = [...finalPath];
      updateLastStep("success");
      await saveState();
    }

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
    await saveState();
  }
}
