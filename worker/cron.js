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
        
        console.log(`[Worker] 开始接收后端返回的任务流...`);
        let startResponseData = null;
        let finished = false;

        const reader = response.body?.getReader();
        if (!reader) {
            console.error(`[Worker] 无法获取响应流`);
            return;
        }

        const decoder = new TextDecoder("utf-8");
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log(`[Worker] 后端响应流已关闭，任务执行完毕！`);
                break;
            }
            
            const chunkText = decoder.decode(value, { stream: true });
            const lines = chunkText.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        
                        if (data.status === "skipped" || data.isEmpty) {
                            console.warn(`[Worker] 任务跳过或无法开始: ${data.message}`);
                            return;
                        }
                        
                        if (data.status === "started") {
                            console.log(`[Worker] 成功触发任务:`, data.message || data);
                            startResponseData = data;
                        } else if (data.status === "completed") {
                            console.log(`[Worker] 收到后端完成信号!`);
                            finished = true;
                        } else if (data.status === "error") {
                            console.error(`[Worker] 收到后端错误信号:`, data.message);
                            finished = true;
                        } else if (data.type === "ping") {
                            // keep-alive
                        } else {
                            console.log(`[Worker] 收到片段流数据:`, JSON.stringify(data).substring(0, 100));
                        }
                    } catch(e) {}
                }
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
