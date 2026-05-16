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
                    if (done) break;
                    
                    const chunkText = decoder.decode(value, { stream: true });
                    const lines = chunkText.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.status === "skipped" || data.isEmpty) {
                                    console.warn(`[Worker] 任务跳过或无法开始:`, data.message);
                                    finished = true;
                                } else if (data.status === "started") {
                                    console.log(`[Worker] 成功触发任务:`, data.message);
                                } else if (data.status === "completed") {
                                    console.log(`[Worker] 后端长连接提示任务完成!`);
                                    finished = true;
                                } else if (data.status === "error") {
                                    console.error(`[Worker] 后端长连接报告错误:`, data.message);
                                    finished = true;
                                }
                            } catch(e) {}
                        }
                    }
                }
            } catch (err) {
                console.error(`[Worker] 流读取异常:`, err.message);
            }
        };

        consumeStream();

        console.log(`[Worker] 开始等待并检查任务...`);

        while (!finished) {
           await new Promise(r => setTimeout(r, 5000));
           if (finished) break;
           
           try {
             // Keep worker running and printing logs conceptually, stream reader does the heavy lifting.
           } catch(pollErr) {
             console.error(`[Worker] 检查过程出错:`, pollErr.message);
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
