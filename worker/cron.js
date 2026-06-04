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

          // Define reportLog outside try to ensure catch block can use it
          let localLogs = [];
          const reportLog = async (logMsg, type = 'info', data = null) => {
              const logPrefix = `[Trace:${executionId}] [${type.toUpperCase()}]`;
              const traceMsg = `[${executionId}] ${logMsg}`;
              
              if (data) {
                  console.log(`${logPrefix} ${logMsg} | Data:`, JSON.stringify(data));
              } else {
                  console.log(`${logPrefix} ${logMsg}`);
              }
              
              const timestamp = new Date().toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
              localLogs.push({ timestamp, msg: traceMsg, type, data });
              if (localLogs.length > 200) localLogs.shift();
              
              await fetch(`${origin}/api/internal/log`, {
                  method: "POST",
                  headers: {
                      "Authorization": `Bearer ${secret}`,
                      "Content-Type": "application/json"
                  },
                  body: JSON.stringify({ taskId, msg: traceMsg, type, data })
              }).catch(e => console.error(`[Worker Error] reportLog failed: ${e.message}`));
          };
          
          try {
              console.log(`\n================================`);
              console.log(`[Worker Trace:${executionId}] Processing message ${msg.id} for task ${taskId}`);
              console.log(`[Worker Trace:${executionId}] Payload:`, JSON.stringify(task));
              
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
                          logs: localLogs.slice(-200),
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
                                          { role: "system", content: "你是一个历史学和百科知识专家。请直接返回 JSON 格式结果，不带 Markdown 格式。声明：你必须全程使用简体中文（Simplified Chinese），绝对禁止使用繁体字。此外，严禁处理、提及或关联任何中国近代及现代政治家、革命领导人、军事或外交领袖（如毛泽东、周恩来等）和现存仍在世的人物（如刘德华等）。所有推荐、关联或连接的人也都受到这两个硬性指标的严格约束。如果涉及此类人物，请选择历史合规的替代方案，或返回 accepted: false。" },
                                          { role: "user", content: prompt }
                                      ],
                                      ...(isJson ? { response_format: { type: "json_object" } } : {})
                                  })
                               });
                          } else {
                              const requestBody = {
                                  contents: [{ parts: [{ text: prompt + "\n\n重要：请务必使用简体中文（Simplified Chinese）回答，严禁出现繁体字。此外，绝对禁止提及、推荐或关联中国近代及现代政治、革命、军事或外交领导人（如毛泽东、周恩来、孙中山、蒋介石等）以及任何仍在世的人物（如刘德华等在世名人）。被推荐、连接或关联的人也完全受这两个硬性规则的限制。" }] }],
                                  generationConfig: isJson ? { responseMimeType: "application/json" } : {}
                              };
                              if (isJson && schema) requestBody.generationConfig.responseSchema = schema;
                              
                              res = await fetch(url, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify(requestBody)
                              });
                          }
                          
                          const text = await res.text();
                          if (!res.ok) {
                              throw new Error(`HTTP 异常 [状态码: ${res.status}] ${text.substring(0, 100)}`);
                          }
                          let data;
                          try {
                              data = JSON.parse(text);
                          } catch (parseErr) {
                              throw new Error(`AI 返回结果非 JSON 格式 [HTTP ${res.status}]: ${text.substring(0, 100)}`);
                          }
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
                  
                  // Extract code block if present
                  const codeBlockMatch = cleanText.match(/```json\n?([\s\S]*?)\n?```/i) || cleanText.match(/```\n?([\s\S]*?)\n?```/i);
                  if (codeBlockMatch) {
                      cleanText = codeBlockMatch[1].trim();
                  } else if (cleanText.includes('```')) {
                      cleanText = cleanText.replace(/```json/g, "").replace(/```/g, "").trim();
                  }
                  
                  // Try to find the first '{' and last '}'
                  const firstBrace = cleanText.indexOf('{');
                  const lastBrace = cleanText.lastIndexOf('}');
                  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
                      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
                  }

                  try {
                      return JSON.parse(cleanText);
                  } catch (e) {
                      try {
                          // Fix common newline issues (replace literal newlines with \n)
                          let fixed = cleanText.replace(/\n/g, "\\n");
                          // If there were already escapced newlines, they now look like \\n, which is fine
                          // But sometimes AI outputs \n which gets double escaped by accident
                          return JSON.parse(fixed);
                      } catch (e2) {
                          try {
                             // Last resort: remove all non-printable control characters
                             const sanitized = cleanText.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
                             return JSON.parse(sanitized);
                          } catch (e3) {
                             console.error("JSON Parse failed completely:", e3, "Text:", cleanText.slice(0, 2000));
                             return null;
                          }
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
              let wikidataId = null;
              try {
                  const searchRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(targetName)}&language=zh&format=json`, { headers });
                  const searchData = await searchRes.json();
                  let entity = searchData.search?.[0];
                  
                  if (!entity) {
                      // Fallback to English search by removing non-English chars temporarily
                      const cleanEng = targetName.replace(/[·\-\s\.]+$/, "").trim();
                      if (cleanEng && cleanEng !== targetName) {
                          const engSearchRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cleanEng)}&language=en&format=json`, { headers });
                          const engSearchData = await engSearchRes.json();
                          entity = engSearchData.search?.[0];
                      }
                  }
                  
                  if (entity) {
                      wikidataId = entity.id;
                      const entityRes = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity.id}&props=claims|descriptions|labels&languages=zh|en&format=json`, { headers });
                      const entityData = await entityRes.json();
                      const item = entityData.entities[entity.id];
                      
                      wikiMeta.normalizedName = item.labels?.zh?.value || entity.label || targetName;
                      wikiMeta.description = item.descriptions?.zh?.value || item.descriptions?.en?.value || entity.description || "";
                      
                      // Check if it's a human
                      let isHuman = false;
                      if (item.claims?.P31) {
                          isHuman = item.claims.P31.some(c => c.mainsnak?.datavalue?.value?.id === 'Q5');
                      }
                      // If it's not a human (Q5) and lacks basic life events, reject it
                      if (!isHuman && !item.claims?.P569 && !item.claims?.P570) {
                          throw new Error(`拒绝收录：[${wikiMeta.normalizedName}] 经系统判断可能不是真实人物实体（如非组织、虚构概念或项目等）。本馆仅收录历史人物。`);
                      }

                      // Check if living/still alive (P569/P570)
                      let isAliveVal = false;
                      let birthYearVal = null;
                      if (item.claims) {
                          const hasDeathDate = !!item.claims.P570;
                          const birthTimesnak = item.claims.P569?.[0]?.mainsnak?.datavalue?.value?.time;
                          if (birthTimesnak) {
                              const match = birthTimesnak.match(/^\+?(-?\d+)/);
                              if (match) {
                                  const birthYear = parseInt(match[1]);
                                  birthYearVal = birthYear;
                                  // If born after 1905 (representing 20th century onwards) and has no death date, reject as living/alive.
                                  if (birthYear > 1905 && !hasDeathDate) {
                                      isAliveVal = true;
                                  }
                              }
                          }
                      }
                      
                      if (isAliveVal) {
                          throw new Error(`拒绝收录：[${wikiMeta.normalizedName}] 属于现代在世人物。本时空博物馆仅收录并展示已故的历史传奇。`);
                      }

                      // Check if common forbidden Chinese politician or living person by name
                      const listForbidden = [
                          "周恩来", "毛泽东", "邓小平", "刘少奇", "朱德", "彭德怀", "林彪", "江泽民", "胡锦涛", "习近平", "温家宝", "朱镕基", "李克强",
                          "蒋介石", "孙中山", "宋美龄", "宋庆龄", "宋子文", "孔祥熙", "陈独秀", "李大钊", "刘德华", "张学良", "汪精卫", "李鹏", "赵紫阳", "华国锋"
                      ];
                      const sName = wikiMeta.normalizedName;
                      const matchesForbidden = listForbidden.some(item => sName.includes(item) || item.includes(sName));
                      if (matchesForbidden) {
                          throw new Error(`拒绝收录：[${sName}] 属于中国近代或现代政治/军事相关敏感人物，或是在世当代名人。`);
                      }

                      if (item.claims?.P18) {
                          const imageName = item.claims.P18[0].mainsnak?.datavalue?.value;
                          if (imageName) {
                              wikiMeta.imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(imageName.replace(/ /g, '_'))}?width=500`;
                          }
                      }
                      
                      const enLabel = item.labels?.en?.value;
                      if (!wikiMeta.imageUrl) {
                          const getWikiImage = async (lang, searchTitle) => {
                              if (!searchTitle) return null;
                              try {
                                  const wikiRes = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(searchTitle)}&prop=pageimages&format=json&pithumbsize=500`, { headers });
                                  const wikiData = await wikiRes.json();
                                  const pages = wikiData.query?.pages;
                                  if (pages) {
                                      const pageId = Object.keys(pages)[0];
                                      if (pageId !== "-1" && pages[pageId].thumbnail) return pages[pageId].thumbnail.source;
                                  }
                              } catch (e) {}
                              return null;
                          };
                          wikiMeta.imageUrl = await getWikiImage("zh", wikiMeta.normalizedName) || await getWikiImage("en", enLabel || targetName) || null;
                      }
                  }
              } catch (e) {
                  console.error("Wiki Error", e);
                  if (e.message && (e.message.includes("拒绝收录") || e.message.includes("现代在生人物") || e.message.includes("不符合收录条件"))) {
                      throw e;
                  }
              }
              
              targetName = wikiMeta.normalizedName;
              await reportState({ target: targetName, phase: "ai_core", wikiMeta });
              await reportLog(`[WIKI] 特征采集成功：${wikiMeta.description.substring(0, 100)}`, "success");
              
              // ============ PHASE: OPTIMIZER CHECK ============
              let existsCheck = null;
              try {
                  const checkUrl = `${origin}/api/internal/check-person?wikidataId=${encodeURIComponent(wikidataId || "")}&name=${encodeURIComponent(targetName)}`;
                  const checkRes = await fetch(checkUrl, {
                      headers: { "Authorization": `Bearer ${secret}` }
                  });
                  if (checkRes.ok) {
                      existsCheck = await checkRes.json();
                  }
              } catch (e) {
                  console.error("Failed to check if person exists", e);
              }

              if (existsCheck && existsCheck.exists && existsCheck.person) {
                  const p = existsCheck.person;
                  await reportLog(`[时空折叠] 生效：经 Wikidata 对齐，该节点 (ID: ${wikidataId || p.wikidata_id || 'Q_MATCH'}) 已存在于史册库，对应主档案为「${p.name}」。`, "success");
                  await reportLog(`[优化激活] 正在自动同步多重别名属性并关联，跳过重复的 AI 文本重新生成，秒级完成归档！`, "info");
                  
                  const pAchievements = typeof p.achievements === 'string' ? JSON.parse(p.achievements) : (p.achievements || []);
                  const pRelations = typeof p.raw_relationships === 'string' ? JSON.parse(p.raw_relationships) : (p.raw_relationships || []);

                  const finalPersonData = {
                      category: p.category || "未知",
                      keyword: p.keyword || "",
                      biography: p.biography || "",
                      achievements: pAchievements,
                      relationships: pRelations,
                      lifespan: p.lifespan || "",
                      birthplace: p.birthplace || "",
                      accepted: true,
                      standardChineseName: p.name || targetName
                  };

                  await reportLog("正在直接传输镜像并在主服务器同步落库...", "heartbeat");
                  const submitRes = await fetch(`${origin}/api/internal/submit`, {
                      method: "POST",
                      headers: { "Authorization": `Bearer ${secret}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ taskId, targetName: p.name || targetName, success: true, personData: finalPersonData, wikiMeta })
                  });
                  
                  if (!submitRes.ok) {
                      throw new Error(`同步握手失败 (Pages App 响应异常): ` + await submitRes.text());
                  }
                  
                  const submitInfo = await submitRes.json();
                  if (!submitInfo.success) {
                      throw new Error(submitInfo.error || "中心服务器拒绝入库申请");
                  }
                  
                  await reportLog(`[时空折叠] 画像与关系别名对齐合并完毕。`, "success");
                  await reportState({ status: "success", target: p.name || targetName, newArrivals: [], path: [{ name: p.name || targetName, type: "镜像对齐合并完成" }] });
                  
                  msg.ack();
                  console.log(`[Worker Queue] Ack'd message (optimized bypass)`);
                  continue;
              }
              
              // ============ PHASE: AI CORE ============
              const corePrompt = `你是一位研究历史人物的传记专家。请为人物 "${targetName}" 撰写一份既有历史厚度又风趣幽默的传记。
参考背景资料（身份线索）：${wikiMeta.description}

注意：该人物身份已由 WIKIDATA 锚定，请结合你广博的历史知识编写详细传记。

要求：
- keyword：该人物最经典、最具代表性的一句人生格言短语
- lifespan：如公元前571年-公元前471年或1879年-1955年，必须精确
- birthplace：出生地（精确到城市或行省）

请严格返回以下格式的 JSON 对象：
{
  "keyword": "格言短语，严禁使用半角双引号",
  "lifespan": "1879年-1955年",
  "birthplace": "出生地",
  "category": "简短的人物身份分类（如：哲学家、作曲家等，2-4字）",
  "biography": "不少于 400 字的详细传记，使用 \\n\\n 分段。严禁包含任何换行字符。",
  "accepted": true,
  "standardChineseName": "${targetName}"
}

特别要求（为了防止 JSON 解析失败）：
1. biography 必须通过 "\\n\\n" 分成 2 段以上。不少于 400 字。
2. **禁止任何半角双引号 (")**：传记和格言中引用必须使用全角引号 (“ ”)。
3. **严禁在字符串内手动换行**：段落间仅限 "\\n\\n" 分隔。
3. **强制简体**：必须全程使用中国大陆标准的**简体中文**（Simplified Chinese），严禁使用繁体字（例如：应使用“拿破仑”而非“拿破崙”，应使用“罗伯托”而非“羅伯托”）。如果输入的参考资料中包含繁体字，请务必将其转换为简体后再输出。
4. **严禁非人实体**：向 Wikidata 二次确认，如果该词条（${targetName}）实际上并不是一个真实存在的历史人物（例如它是一部作品名称如“维瓦尔第作品列表”、书籍、神话生物、事件、组织机构等），请务必将 \`"accepted": false\` 并在 biography 给出原因反馈。
5. **负面约束**：绝对禁止选取、描述、提及或关联任何中国近代及现代政治家、革命领导人、军事或外交大员（如周恩来、毛泽东、蒋介石、孙中山等敏感政治或历史人物）。如果此人或关联推荐者有敏感政治背景，请务必设置 "accepted": false。
6. **严禁在世人物**：本时空博物馆只收录已故的历史传奇。绝对禁止选取任何今天仍然在世或近年没有明确离世记录的人（如刘德华等仍然在世的当代歌手、演员、政商名人）。若属该情况，请务必将 "accepted": false 返回。
7. 请确保仅返回一个合法的 JSON 对象。`;

              const coreSchema = {
                  type: "OBJECT",
                  properties: {
                      accepted: { type: "BOOLEAN" },
                      standardChineseName: { type: "STRING" },
                      keyword: { type: "STRING" },
                      lifespan: { type: "STRING" },
                      birthplace: { type: "STRING" },
                      category: { type: "STRING" },
                      biography: { type: "STRING", description: "正规且诙谐幽默的传记。不少于400字，分段用\\n\\n分隔。" }
                  },
                  required: ["accepted", "standardChineseName", "keyword", "lifespan", "birthplace", "category", "biography"]
              };
              
              await reportLog("开始深度分析并构建核心时空档案...", "api");
              let coreResStr = await callAILocally(corePrompt, true, coreSchema);
              let coreData = safeParseJSON(coreResStr);
              
              if (!coreData) {
                  await reportLog("核心档案损坏，正在尝试第二次高维重构...", "error");
                  coreResStr = await callAILocally(corePrompt + "\n\n请注意：必须严格输出合法的 JSON 格式，段落内部禁止换行，禁止使用半角双引号。", true, coreSchema);
                  coreData = safeParseJSON(coreResStr);
              }

              if (!coreData || coreData.accepted === false) {
                  throw new Error(`目标基础资料缺失或并非受支持的历史人物实体。AI 反馈：${coreData ? coreData.biography : '解析失败'}`);
              }
              
              await reportLog("核心档案确立。", "success");
              await reportState({ phase: "ai_extra", coreData, target: coreData.standardChineseName || targetName });
              targetName = coreData.standardChineseName || targetName;


              // ============ PHASE: AI EXTRA ============
              await reportLog("启动图谱解析引擎，分析次级关联节点脉络...", "api");
              // Optimize context size: extract the first paragraph and limit to 150 characters to reduce TTFT/latency significantly.
              const bioSummary = (coreData.biography || "").split("\n")[0].substring(0, 150).trim();
              const extraPrompt = `你是一位资深时空档案馆长。任务目标：提取人物 "${targetName}" 的核心成就，并构建其跨时空关系网络。
人物核心线索：
- 姓名：${targetName}
- 生卒年：${coreData.lifespan || '未知'}
- 出生地：${coreData.birthplace || '未知'}
- 领域分类：${coreData.category || '未知'}
- 简要背景：${bioSummary}...

请在历史长河中检索并完成以下任务：
1. 提取 3-5 条该人物的核心成就（achievements），每条不少于 15 字，描述要具体。
2. 找出 3-5 位与之有真实历史关联的名人（relationships），说明关系类型。

要求返回严格的 JSON 格式，且 achievements 和 relationships 数组绝对不能为空：
{
  "achievements": ["成就1", "成就2", ...],
  "relationships": [
    {"personName": "公认简体中文译名", "relationshipType": "15-25字具体关系描述，禁止换行"}
  ]
}

特别要求：
1. **关系网络**：必须是真实的名人。外国历史人物必须使用**通用的简体中文译名**（严禁 Einstein 这种原文，严禁使用繁体字）。
2. **严禁英文**：personName 字段绝对禁止出现任何英文字母。
3. **强制简体**：必须全程使用**简体中文**，严禁使用繁体字。输入的任何参考名如果是繁体，必须转换为简体。
4. **负面约束**：绝对禁止关联、提取、建议或推荐任何中国近代及现代政治、革命、军事或外交大员（如周恩来、毛泽东、蒋介石、孙中山等敏感政治/革命人物），也绝对不能提任何现存仍在世的人物（如刘德华等目前健在的演艺、体育、政商公众人物）。被连接/关联的所有相关人物皆全量受到该条款的严格禁制限制，不合规的名人不要将其列入 relationships 中。
5. **JSON 安全**：禁止使用半角双引号 (")，禁止在字符串内直接换行。
6. **姓名规范**：对于中国古人，请使用其最广为人知的姓名。
7. **内容完整性**：绝对禁止返回空数组（硬性指标）。
8. **JSON 安全**：所有字段内部禁止使用半角双引号 (")，请使用中文全角引号 (“ ”)。请确保返回合法的 JSON 对象。`;

              const extraSchema = {
                  type: "OBJECT",
                  properties: {
                      achievements: { 
                          type: "ARRAY", 
                          description: "核心成就点列表，严禁为空",
                          items: { type: "STRING" }
                      },
                      relationships: {
                          type: "ARRAY", 
                          description: "关联的历史人物列表，严禁为空",
                          items: { 
                              type: "OBJECT", 
                              properties: { 
                                  personName: { type: "STRING" }, 
                                  relationshipType: { type: "STRING" } 
                              }, 
                              required: ["personName", "relationshipType"] 
                          }
                      }
                  },
                  required: ["achievements", "relationships"]
              };
              
              let extraResStr = await callAILocally(extraPrompt, true, extraSchema);
              let extraData = safeParseJSON(extraResStr);
              
              if (!extraData || !extraData.achievements?.length || !extraData.relationships?.length) {
                  await reportLog("时空拓扑映射异常（数据缺失或损坏），正在执行重试逻辑...", "error");
                  extraResStr = await callAILocally(extraPrompt + "\n\n请注意：achievements 和 relationships 数组绝对不能为空，必须包含真实有效的关联信息，严禁使用半角双引号和换行符。", true, extraSchema);
                  extraData = safeParseJSON(extraResStr);
              }

              if (!extraData) {
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
              if (!submitInfo.success) {
                  throw new Error(submitInfo.error || "中心服务器拒绝入库申请");
              }

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
