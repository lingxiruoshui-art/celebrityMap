// Cloudflare Worker: worker/cron.js
export default {
  async fetch(request, env, ctx) {
      console.log(`[Worker] Fetch triggered: ${request.method} ${request.url}`);
      return new Response("Celebrity Explore Worker is running. (Scheduled & Queue active)", {
          headers: { "content-type": "text/plain;charset=UTF-8" }
      });
  },

  async scheduled(event, env, ctx) {
    const targetUrl = env.CRON_TARGET_URL;
    const secret = env.CRON_SECRET;
    
    if (!targetUrl || !secret) {
      console.error("[Worker Error] Environment variables CRON_TARGET_URL or CRON_SECRET are missing in Worker dashboard!");
      return;
    }
    
    const origin = new URL(targetUrl).origin;
    const taskUrl = `${origin}/api/internal/next-task`;
    
    console.log(`[Worker] [Scheduled] Triggered. Target app: ${origin}. Checking for tasks...`);
    
    try {
        const res = await fetch(taskUrl, {
            headers: {
                "Authorization": `Bearer ${secret}`
            }
        });
        
        if (!res.ok) {
            const errorText = await res.text();
            console.error(`[Worker Error] [Scheduled] Pages App returned ${res.status}: ${errorText}`);
            return;
        }
        
        const task = await res.json();
        
        if (task && task.taskId) {
            console.log(`[Worker] [Scheduled] Task found! Target: ${task.targetName || 'RANDOM'}, ID: ${task.taskId}. Handing off to Queue...`);
            
            // Notify Pages that we've seen the task and are queuing it
            await fetch(`${origin}/api/internal/log`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${secret}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ 
                    taskId: task.taskId, 
                    msg: `[Worker] 调度程序已捕获任务，正在准备进入集群队列 [Worker -> Queue]`, 
                    type: 'info' 
                })
            }).catch(()=>{});

            if (env.EXPLORE_QUEUE) {
                try {
                    await env.EXPLORE_QUEUE.send(task);
                    console.log(`[Worker] [Scheduled] Queue hand-off successful for task ${task.taskId}.`);
                    
                    await fetch(`${origin}/api/internal/log`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${secret}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ 
                            taskId: task.taskId, 
                            msg: `[Worker] 任务已成功推入高速队列，等待分发执行 [Queue OK]`, 
                            type: 'success' 
                        })
                    }).catch(()=>{});
                } catch (queueErr) {
                    console.error(`[Worker Error] [Scheduled] Failed to send to Queue: ${queueErr.message}`);
                    await fetch(`${origin}/api/internal/log`, {
                        method: "POST",
                        headers: {
                            "Authorization": `Bearer ${secret}`,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ 
                            taskId: task.taskId, 
                            msg: `[Worker] 任务排队失败: ${queueErr.message}`, 
                            type: 'error' 
                        })
                    }).catch(()=>{});
                }
            } else {
                console.error(`[Worker Error] [Scheduled] EXPLORE_QUEUE binding is missing!`);
                await fetch(`${origin}/api/internal/log`, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${secret}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ 
                        taskId: task.taskId, 
                        msg: `[Worker Error] EXPLORE_QUEUE 绑定缺失，无法执行任务`, 
                        type: 'error' 
                    })
                }).catch(()=>{});
            }
        } else {
            console.log(`[Worker] [Scheduled] No work to do at this time.`);
        }
    } catch (e) {
        console.error(`[Worker Error] [Scheduled] Connection failure: ${e.message}`);
    }
  },
  
  async queue(batch, env, ctx) {
      console.log(`[Worker Queue] Received batch with ${batch.messages.length} messages.`);
      const origin = new URL(env.CRON_TARGET_URL).origin;
      const secret = env.CRON_SECRET;
      
      for (const msg of batch.messages) {
          const task = msg.body;
          const { taskId, modelConfig } = task;
          let targetName = task.targetName;
          
          // Generate a unique trace ID for this specific batch execution
          const executionId = Math.random().toString(36).substring(2, 10);
          
          try {
              console.log(`\n================================`);
              console.log(`[Worker Trace:${executionId}] Processing message ${msg.id} for task ${taskId}`);
              console.log(`[Worker Trace:${executionId}] Payload:`, JSON.stringify(task));
              
              let localLogs = [];
              const reportLog = async (logMsg, type = 'info', data = null) => {
                  const logPrefix = `[Trace:${executionId}] [${type.toUpperCase()}]`;
                  
                  // Use richer data for trace
                  const traceMsg = `[${executionId}] ${logMsg}`;
                  
                  if (data) {
                      console.log(`${logPrefix} ${logMsg} | Data:`, JSON.stringify(data));
                  } else {
                      console.log(`${logPrefix} ${logMsg}`);
                  }
                  
                const timestamp = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
                  localLogs.push({ timestamp, msg: traceMsg, type, data });
                  if (localLogs.length > 50) localLogs.shift();
                  
                  await fetch(`${origin}/api/internal/log`, {
                      method: "POST",
                      headers: {
                          "Authorization": `Bearer ${secret}`,
                          "Content-Type": "application/json"
                      },
                      body: JSON.stringify({ taskId, msg: traceMsg, type, data })
                  }).catch(e => console.error(`[Worker Error] reportLog failed: ${e.message}`));
              };
              
              // Helper to update Pages global state
              const reportState = async (updates) => {
                  try {
                      console.log(`[Worker Queue] [State Update] Phase: ${updates.phase || 'N/A'}`);
                      // Fetch current state to avoid overwriting other fields unnecessarily
                      const statusRes = await fetch(`${origin}/api/explore/status`, { headers: {"x-admin-password": secret} });
                      let currentState = {};
                      if (statusRes.ok) {
                         const json = await statusRes.json();
                         if (json) currentState = json;
                      }
                      
                      const newState = {
                          ...currentState,
                          status: "running",
                          taskId,
                          target: targetName,
                          ...updates,
                          logs: localLogs.slice(-50),
                          lastHeartbeat: Date.now()
                      };
                      
                      await fetch(`${origin}/api/internal/state`, {
                          method: "POST",
                          headers: {
                              "Authorization": `Bearer ${secret}`,
                              "Content-Type": "application/json"
                          },
                          body: JSON.stringify(newState)
                      }).catch(e => console.error(`[Worker Error] reportState failed: ${e.message}`));
                  } catch(e) {
                      console.error(`[Worker Error] reportState exception: ${e.message}`);
                  }
              };
              
              await reportLog(`[Worker Cluster] 成功捕获分发任务，初始化时空节点生命周期 [ID: ${taskId}]`, "info");
              await reportState({ phase: "init", steps: [{ msg: "探索序列启动中...", status: "pending", startTime: Date.now() }] });
              
              // Define callAI helper
              const callAILocally = async (prompt, isJson = true, schema = null) => {
                  const isAliyun = modelConfig.provider === "aliyun";
                  const apiKey = isAliyun ? modelConfig.aliyunApiKey : modelConfig.apiKey;
                  const modelId = isAliyun ? (modelConfig.aliyunModelId || "qwen-max") : (modelConfig.modelId || "gemini-1.5-flash");
                  
                  if (!apiKey) throw new Error(`时空协议中断：检测到 ${isAliyun ? 'Aliyun' : 'Gemini'} 通讯密钥缺失，请检查配置。`);

                  const url = isAliyun 
                    ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
                    : `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
                  
                  await reportLog(`正在请求高维 AI 节点 (${isAliyun ? 'Aliyun' : 'Gemini'}): ${modelId}`, "ai-req", { prompt: prompt });
                  
                  // Simple retry logic
                  for (let i = 0; i < 3; i++) {
                      try {
                          let res;
                          if (isAliyun) {
                              res = await fetch(url, {
                                  method: "POST",
                                  headers: { 
                                      "Authorization": `Bearer ${apiKey}`,
                                      "Content-Type": "application/json" 
                                  },
                                  body: JSON.stringify({
                                      model: modelId,
                                      messages: [
                                          { role: "system", content: "你是一个历史学和百科知识专家。请直接返回 JSON 格式结果，不带 Markdown 格式。" },
                                          { role: "user", content: prompt }
                                      ],
                                      ...(isJson ? { response_format: { type: "json_object" } } : {})
                                  })
                               });
                          } else {
                              const requestBody = {
                                  contents: [{ parts: [{ text: prompt }] }],
                                  generationConfig: isJson ? { responseMimeType: "application/json" } : {}
                              };
                              if (isJson && schema) requestBody.generationConfig.responseSchema = schema;
                              
                              res = await fetch(url, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify(requestBody)
                              });
                          }
                          
                          const data = await res.json();
                          if (data.error) throw new Error(data.error.message || "Unknown AI API error");
                          
                          let content = "";
                          if (isAliyun) {
                              content = data.choices[0].message.content;
                          } else {
                              content = data.candidates[0].content.parts[0].text;
                          }
                          
                          await reportLog(`AI 时空映射响应成功 (${isAliyun ? 'Aliyun' : 'Gemini'})`, "ai-res", { preview: content });
                          return content;
                      } catch (e) {
                          if (i === 2) throw e;
                          await new Promise(r => setTimeout(r, 2000 * (i+1))); 
                          await reportLog(`通讯链路不稳定 (${isAliyun ? 'Aliyun' : 'Gemini'})，正在执行应急重试策略 (${i+1}/3)...: ${e.message}`, "heartbeat");
                      }
                  }
              };

              // Enhanced JSON parsing with safety
              function safeParseJSON(text) {
                  if (!text) return null;
                  let cleanText = text.trim();
                  
                  // Extract code block if present (even if not at the start)
                  const codeBlockMatch = cleanText.match(/```json\n?([\s\S]*?)\n?```/i) || cleanText.match(/```\n?([\s\S]*?)\n?```/i);
                  if (codeBlockMatch) {
                      cleanText = codeBlockMatch[1].trim();
                  } else if (cleanText.includes('```')) {
                      // fallback for weird markdown
                      cleanText = cleanText.replace(/```json/g, "").replace(/```/g, "").trim();
                  }
                  
                  // Try to find the first '{' and last '}'
                  const firstBrace = cleanText.indexOf('{');
                  const lastBrace = cleanText.lastIndexOf('}');
                  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
                      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
                  }

                  try {
                      // Replace escaped newlines if AI used actual newlines in strings
                      return JSON.parse(cleanText.replace(/\n/g, ' '));
                  } catch (e) {
                      // One more try: remove control characters and retry
                      try {
                          const sanitized = cleanText
                            .replace(/[\u0000-\u001F\u007F-\u009F]/g, "") // remove control chars
                            .replace(/\\n/g, "\\n") // ensure valid escapes
                            .replace(/\r/g, "");
                          return JSON.parse(sanitized);
                      } catch (e2) {
                          console.error("JSON Parse failed even after cleaning:", e2, "Text:", cleanText);
                          return null;
                      }
                  }
              }

              // ============ PHASE: INIT & WIKI ============
              if (!targetName) {
                  throw new Error(`时空协议失效：任务报文中未包含有效人物标识码 [targetName is empty]`);
              }
              
              await reportState({ target: targetName });
              await reportLog(`检索维基数据：${targetName}`, "info");
              
              // Wikipedia fetch
              const headers = { "User-Agent": "HistoricalArchiveApp/1.0" };
              let wikiMeta = { normalizedName: targetName, description: "", imageUrl: null };
              try {
                  const searchRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(targetName)}&language=zh&format=json`, { headers });
                  const searchData = await searchRes.json();
                  const entity = searchData.search?.[0];
                  
                  if (entity) {
                      const entityRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims|descriptions|labels&languages=zh|en&format=json`, { headers });
                      const entityData = await entityRes.json();
                      const item = entityData.entities[entity.id];
                      
                      wikiMeta.normalizedName = item.labels?.zh?.value || entity.label || targetName;
                      wikiMeta.description = item.descriptions?.zh?.value || item.descriptions?.en?.value || entity.description || "";
                      
                      if (item.claims?.P18) {
                          const imageName = item.claims.P18[0].mainsnak?.datavalue?.value;
                          if (imageName) {
                              wikiMeta.imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName.replace(/ /g, '_'))}?width=500`;
                          }
                      }
                  }
              } catch (e) {
                  console.error("Wiki Error", e);
              }
              
              if (!wikiMeta.imageUrl) {
                  throw new Error(`缺少真实相片影像或档案：为了确保连通网络的品质，中心服务器拒绝接收此请求。`);
              }
              
              targetName = wikiMeta.normalizedName;
              await reportState({ target: targetName, phase: "ai_core", wikiMeta });
              await reportLog(`[WIKI] 特征采集成功：${wikiMeta.description.substring(0, 100)}`, "success");
              
              
              // ============ PHASE: AI CORE ============
              const corePrompt = `你是一位研究历史人物的传记专家。请为人物 "${targetName}" 撰写一份既有历史厚度又风趣幽默的传记。
参考背景资料：${wikiMeta.description}

要求仅返回合法JSON格式对象：
{
  "accepted": true/false，判断该人物是否真实已故客观存在，如果有神话虚构元素返回false,
  "standardChineseName": "标准中文全名",
  "keyword": "该人物的一句人生格言短语",
  "lifespan": "生卒年份，如1879年-1955年",
  "birthplace": "出生地",
  "category": "从以下选择：[哲学家, 艺术家, 科学家, 发明家, 政治家, 军事家, 思想家, 文学家, 诗人, 音乐家, 医学家, 其他名流]",
  "biography": "严肃又幽默的传记，不少于200字，必须至少分成2段。在 JSON 字符串内部用 \\n\\n 代表换行，绝不可以直接回车截断字符串。",
  "latitude": 纬度数字类型的浮点数,
  "longitude": 经度数字类型的浮点数
}`;
              const coreSchema = {
                  type: "OBJECT",
                  properties: {
                      accepted: { type: "BOOLEAN" },
                      standardChineseName: { type: "STRING" },
                      keyword: { type: "STRING" },
                      lifespan: { type: "STRING" },
                      birthplace: { type: "STRING" },
                      category: { type: "STRING" },
                      biography: { type: "STRING" },
                      latitude: { type: "NUMBER" },
                      longitude: { type: "NUMBER" }
                  },
                  required: ["accepted", "standardChineseName", "keyword", "lifespan", "birthplace", "category", "biography", "latitude", "longitude"]
              };
              
              await reportLog("开始深度分析并构建核心时空档案...", "api");
              const coreResStr = await callAILocally(corePrompt, true, coreSchema);
              let coreData = safeParseJSON(coreResStr);
              
              if (!coreData || coreData.accepted === false) {
                  throw new Error(`目标基础资料缺失或并非受支持的绝对真实历史人物大图鉴内容。`);
              }
              
              await reportLog("核心档案确立。", "success");
              await reportState({ phase: "ai_extra", coreData, target: coreData.standardChineseName || targetName });
              targetName = coreData.standardChineseName || targetName;


              // ============ PHASE: AI EXTRA ============
              await reportLog("启动图谱解析引擎，分析次级关联节点脉络...", "api");
              const extraPrompt = `你是一位时空档案馆长。已知人物：${targetName}\n背景资料：${coreData.biography}\n\n请在历史长河中检索，找出3-5位与之有一定关联的老少咸宜真实世界历史名人作为关联拓扑节点。要求返回合法的 JSON 格式。`;
              const extraSchema = {
                  type: "OBJECT",
                  properties: {
                      achievements: { type: "ARRAY", items: { type: "STRING", description: "提取的成就点列表" } },
                      relationships: {
                          type: "ARRAY", items: { type: "OBJECT", properties: { personName: { type: "STRING" }, relationshipType: { type: "STRING" } }, required: ["personName", "relationshipType"] }
                      }
                  }
              };
              
              const extraResStr = await callAILocally(extraPrompt, true, extraSchema);
              let extraData = safeParseJSON(extraResStr);
              
              if (!extraData) {
                  await reportLog("时空拓扑映射异常（JSON 损坏），正在启用紧急冗余容错机制...", "error");
                  extraData = { achievements: [], relationships: [] };
              }
              
              await reportLog(`拓扑网络构建完成，发现 ${extraData.relationships?.length || 0} 个关联奇点。`, "success");
              const finalPersonData = { ...coreData, ...extraData };
              
              
              // ============ PHASE: SUBMIT ============
              await reportLog("任务阶段全部达成。正在向核心档案馆发起入库同步申请 [Syncing...]", "heartbeat");
              const submitRes = await fetch(`${origin}/api/internal/submit`, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ taskId, targetName, success: true, personData: finalPersonData, wikiMeta })
              });
              
              if (!submitRes.ok) {
                  throw new Error(`同步握手失败 (Pages App 响应异常): ` + await submitRes.text());
              }
              
              const submitInfo = await submitRes.json();
              if (submitInfo.serverLogs && Array.isArray(submitInfo.serverLogs)) {
                  for (const sLog of submitInfo.serverLogs) {
                      const sType = (sLog.type || 'SERVER').toUpperCase();
                      console.log(`[Log ${sType}] (Pages) ${sLog.msg}`);
                  }
              }
              
              await reportLog(`核心服务器已响应同步成功，${targetName} 全息镜像已固化于史册库。`, "success");
              await reportState({ status: "success", target: targetName, newArrivals: [targetName], path: [{ name: targetName, type: "镜像加载完成" }] });
              
          } catch (e) {
              console.error(`[Worker Cluster Fatal] Error processing ${targetName}:`, e.message);
              // Report error
              await reportLog(`探索序列发生不可逆熔断: ${e.message}`, "error");

              await fetch(`${origin}/api/internal/submit`, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ taskId, targetName, success: false, error: e.message })
              }).catch(()=>{});
              
              await fetch(`${origin}/api/internal/state`, {
                      method: "POST",
                      headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ status: "error", error: e.message, taskId, target: targetName })
              }).catch(()=>{});
              
              await fetch(`${origin}/api/internal/log`, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ taskId, msg: `探索发生致命熔断错误: ${e.message}`, type: 'error' })
              }).catch(()=>{});
          }
          
          msg.ack();
          console.log(`[Worker Queue] Ack'd message`);
      }
  }
};
