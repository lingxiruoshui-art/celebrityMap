// Cloudflare Worker: worker/cron.js
export default {
  async fetch(request, env, ctx) {
    return new Response("Cron worker 运行正常！此 Worker 主要在后台定期执行。", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const targetUrl = env.CRON_TARGET_URL; // e.g., https://your-app.pages.dev/api/cron
    const secret = env.CRON_SECRET;
    
    if (!targetUrl || !secret) {
      console.error("未配置环境变量: CRON_TARGET_URL 或 CRON_SECRET");
      return;
    }

    try {
      const url = new URL(targetUrl);
      url.searchParams.set("secret", secret);
      
      console.log(`正在触发后台任务: ${url.toString()}`);
      const response = await fetch(url.toString(), {
        method: "POST"
      });
      const text = await response.text();
      console.log(`触发结果 (${response.status}): ${text}`);
    } catch (e) {
      console.error(`触发请求失败:`, e);
    }
  }
};
