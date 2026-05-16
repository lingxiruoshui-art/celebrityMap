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
            console.log(`[Worker] 返回 JSON:`, data);
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
                        console.log(`[Worker] 流读取完成 (done)`);
                        break;
                    }
                    
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || "";
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (trimmedLine.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(trimmedLine.slice(6));
                                if (data.status === "skipped" || data.isEmpty) {
                                    console.warn(`[Worker] 任务跳过或无法开始:`, data.message || "条件未满足");
                                    finished = true;
                                } else if (data.status === "started") {
                                    console.log(`[Worker] 成功触发任务:`, data.message || "探索已启动");
                                } else if (data.status === "completed") {
                                    console.log(`[Worker] 后端长连接提示任务完成!`);
                                    finished = true;
                                } else if (data.status === "error") {
                                    console.error(`[Worker] 后端长连接报告错误:`, data.message || "未知错误");
                                    finished = true;
                                } else if (data.type === "ping") {
                                    // Heartbeat - keep going
                                }
                            } catch(e) {
                                // Partial or malformed JSON, wait for more data
                                console.log(`[Worker] 无法解析数据行，可能是分片: ${trimmedLine.substring(0, 50)}...`);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error(`[Worker] 流读取发生异常:`, err.message);
            }
        };

        consumeStream();

        console.log(`[Worker] 开始每 5 秒轮询任务执行状态...`);

        const startTime = Date.now();
        const MAX_WAIT = 15 * 60 * 1000; // 15 minutes max wait

        while (!finished) {
           await new Promise(r => setTimeout(r, 8000));
           if (finished) break;
           
           if (Date.now() - startTime > MAX_WAIT) {
               console.error(`[Worker] 超过最大等待时间 (15min)，强制停止。`);
               finished = true;
               break;
           }
           
           try {
             // Polling as a secondary check in case SSE disconnects
             const statusUrl = new URL(`${targetHost}/api/explore/status`);
             // We use the same secret for status if supported, otherwise just poll
             const statusRes = await fetch(statusUrl.toString(), {
                headers: { "x-admin-password": secret }
             });
             
             if (statusRes.ok) {
                 const statusData = await statusRes.json();
                 if (!statusData) {
                    console.log(`[Worker] 收到答复: 探索任务似乎已结束(无状态)。`);
                    finished = true;
                    break;
                 }
                 
                 if (statusData.status === "running") {
                    console.log(`[Worker] 任务进行中 -> Phase: ${statusData.phase}, Target: ${statusData.target}`);
                 } else if (statusData.status === "success") {
                    console.log(`[Worker] 轮询确认任务已成功完成!`);
                    finished = true;
                 } else if (statusData.status === "error") {
                    console.error(`[Worker] 轮询发现任务错误:`, statusData.error || "未知错误");
                    finished = true;
                 }
             }
           } catch(pollErr) {
             console.error(`[Worker] 轮询过程出错:`, pollErr.message);
           }
        }
        
        console.log(`[Worker] 流程彻底结束，退出。`);
      } catch (e) {
        console.error(`[Worker] 请求执行异常:`, e.message);
      }
    };

    await deliver();
  }
};
