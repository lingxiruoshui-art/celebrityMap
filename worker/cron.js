// Cloudflare Worker: worker/cron.js
export default {
  async fetch(request, env, ctx) {
    return new Response("Cron worker 运行正常！此 Worker 主要在后台定期执行。", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const targetUrl = env.CRON_TARGET_URL;
    const secret = env.CRON_SECRET;
    
    console.log(`[Worker] 定时任务触发. URL: ${targetUrl || "未配置"}`);

    if (!targetUrl || !secret) {
      console.error("[Worker] 错误: 未配置环境变量 CRON_TARGET_URL 或 CRON_SECRET");
      return;
    }

    const deliver = async () => {
      try {
        const url = new URL(targetUrl);
        url.searchParams.set("secret", secret);
        
        console.log(`[Worker] 正在发送请求到: ${url.hostname}`);
        const response = await fetch(url.toString(), { 
          method: "POST",
          headers: { "User-Agent": "Cloudflare-Cron-Worker" }
        });
        
        let finished = false;
        const targetHost = new URL(targetUrl).origin;

        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
            const data = await response.json().catch(()=>({}));
            console.log(`[Worker] 返回 JSON: ${JSON.stringify(data)}`);
            return;
        }

        // Asynchronously consume the streaming response to keep the backend function alive
        let buffer = "";
        const consumeStream = async () => {
            try {
                const reader = response.body?.getReader();
                if (!reader) {
                    console.log(`[Worker] 响应无 body, 无法流式读取`);
                    return;
                }
                const decoder = new TextDecoder("utf-8");
                while (!finished) {
                    const { done, value } = await reader.read();
                    if (done) {
                        console.log(`[Worker] 服务器主动关闭了 SSE 连接`);
                        break;
                    }
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || "";
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;

                        const rawEvents = trimmedLine.split('data:').filter(p => p.trim());
                        
                        for (const rawEvent of rawEvents) {
                            try {
                                const data = JSON.parse(rawEvent.trim());
                                console.log(`[Worker SSE] 收到消息:`, JSON.stringify(data));
                                
                                if (data.status === "skipped" || data.status === "no target found") {
                                    console.log(`[Worker] 任务跳过或无需执行:`, data.message);
                                    finished = true;
                                } else if (data.status === "started") {
                                    console.log(`[Worker] 成功触发任务:`, data.message || "探索已启动");
                                } else if (data.status === "running") {
                                    console.log(`[Worker] 任务推进 -> Phase: ${data.phase}, Target: ${data.target}`);
                                } else if (data.status === "completed") {
                                    console.log(`[Worker] 后端长连接提示任务完成!`);
                                    finished = true;
                                } else if (data.status === "error") {
                                    console.error(`[Worker] 后端长连接报告错误:`, data.message || "未知错误");
                                    finished = true;
                                } else if (data.type === "ping") {
                                    // Heartbeat - keep going
                                    console.log(`[Worker SSE] 心跳 (ping)`);
                                }
                            } catch(e) {
                                console.log(`[Worker] 无法解析状态数据行或被截断: ${rawEvent.substring(0, 50)}...`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`[Worker] 流读取发生异常:`, err.message);
            }
        };

        consumeStream(); // Non-blocking

        console.log(`[Worker] 开始每 8 秒轮询任务执行状态 作为兜底...`);

        const startTime = Date.now();
        const maxWaitTime = 14 * 60 * 1000; // 14分钟
        
        while (!finished && (Date.now() - startTime < maxWaitTime)) {
           await new Promise(r => setTimeout(r, 8000));
           if (finished) break;
           
           try {
             // Polling as a secondary check in case SSE disconnects but task is still running
             const statusUrl = new URL(`${targetHost}/api/explore/status`);
             const statusRes = await fetch(statusUrl.toString(), {
                headers: { "x-admin-password": secret }
             });
             
             if (statusRes.ok) {
                 const statusData = await statusRes.json();
                 if (!statusData) {
                    console.log(`[Worker Poll] 收到空答复: 探索任务似乎已结束`);
                    finished = true;
                    break;
                 }
                 
                 console.log(`[Worker Poll] 最新状态: ${JSON.stringify(statusData).substring(0, 300)}`);
                 
                 if (statusData.status === "running") {
                    console.log(`[Worker Poll] 任务仍在后端进行中 -> Phase: ${statusData.phase}, Target: ${statusData.target || '未知'}`);
                 } else if (statusData.status === "success") {
                    console.log(`[Worker Poll] 轮询确认任务已成功完成!`);
                    finished = true;
                 } else if (statusData.status === "error") {
                    console.error(`[Worker Poll] 轮询发现任务错误:`, statusData.error || "未知错误");
                    finished = true;
                 }
             } else {
                 console.warn(`[Worker Poll] 请求状态失败，状态码: ${statusRes.status}`);
             }
           } catch(pollErr) {
             console.error(`[Worker Poll] 轮询过程出错:`, pollErr.message);
           }
        }
        
        if (!finished) {
            console.warn(`[Worker] 达到 Worker 最大运行时长 (14min)，主动退出。`);
        }
        
        console.log(`[Worker] 流程彻底结束，退出。`);
      } catch (e) {
        console.error(`[Worker] 请求执行异常:`, e.stack || e.message);
      }
    };

    await deliver();
  }
};
