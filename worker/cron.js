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
        
        const text = await response.text();
        console.log(`[Worker] 响应状态: ${response.status}`);
        
        try {
          const data = JSON.parse(text);
          if (data.status === "skipped") {
            console.warn(`[Worker] 任务跳过: ${data.message}`);
          } else {
            console.log(`[Worker] 成功结果:`, JSON.stringify(data));
          }
        } catch(e) {
          console.log(`[Worker] 原始响应内容: ${text.substring(0, 200)}`);
        }
      } catch (e) {
        console.error(`[Worker] 请求执行异常:`, e.message);
      }
    };

    ctx.waitUntil(deliver());
  }
};
