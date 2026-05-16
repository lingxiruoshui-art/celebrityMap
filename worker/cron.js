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
        let finished = false;
        const maxWaitTime = 14 * 60 * 1000; // 14 mins max wait
        const startTime = Date.now();
        
        while (!finished && (Date.now() - startTime < maxWaitTime)) {
            const url = new URL(targetUrl);
            url.searchParams.set("secret", secret);
            url.searchParams.set("action", "step");
            
            console.log(`[Worker] 正在发送请求 (推进阶段): ${url.hostname}`);
            const response = await fetch(url.toString(), { 
              method: "POST",
              headers: { "User-Agent": "Cloudflare-Cron-Worker" }
            });
            
            const contentType = response.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const data = await response.json().catch(()=>({}));
                console.log(`[Worker] 返回 JSON (阶段结果): ${JSON.stringify(data).substring(0, 300)}`);
                
                if (data.status === "skipped" || data.status === "error" || data.status === "success" || data.status === "idle" || data.status === "no target found") {
                    console.log(`[Worker] 流程判定为中止或完成。`);
                    finished = true;
                } else if (data.status === "running") {
                    console.log(`[Worker] 当前阶段 (${data.phase}) 完成，即将发起新请求推进下一阶段...`);
                    await new Promise(r => setTimeout(r, 1000));
                } else {
                    console.log(`[Worker] 未知状态，停止。`);
                    finished = true;
                }
            } else {
                console.log(`[Worker] 响应非 JSON 格式，无法解析，停止。status: ${response.status}`);
                finished = true;
            }
        }
        
        if (!finished) {
            console.warn(`[Worker] 达到 Worker 最大运行时长 (14min)，主动退出。若未完成则下次 Cron 继续。`);
        }
        
        console.log(`[Worker] 流程彻底结束，退出。`);
      } catch (e) {
        console.error(`[Worker] 请求执行异常:`, e.stack || e.message);
      }
    };

    await deliver();
  }
};
