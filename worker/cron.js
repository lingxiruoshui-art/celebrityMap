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
        
        console.log(`[Worker] 开始接收后端响应...`);
        const text = await response.text();
        
        let startResponseData = null;
        try {
            startResponseData = JSON.parse(text);
        } catch (e) {
            console.error(`[Worker] 无法解析触发响应:`, text.substring(0, 200));
            return;
        }

        if (startResponseData.status === "skipped" || startResponseData.isEmpty) {
            console.warn(`[Worker] 任务跳过或无法开始:`, startResponseData.message);
            return;
        }

        if (startResponseData.status === "started") {
            console.log(`[Worker] 成功触发任务:`, startResponseData.message || startResponseData);
        }

        let finished = false;
        const targetHost = new URL(targetUrl).origin;
        console.log(`[Worker] 开始每 5 秒轮询任务执行状态...`);

        while (!finished) {
           await new Promise(r => setTimeout(r, 5000));
           try {
             const _v = Date.now();
             console.log(`[Worker] 正在通过网络消息问询后端任务状态 (请求ID: ${_v})...`);
             const stRes = await fetch(`${targetHost}/api/explore/status?_v=${_v}`, {
                 headers: {
                     "User-Agent": "Cloudflare-Cron-Worker",
                     "x-admin-password": secret
                 }
             });
             
             if (!stRes.ok) {
                 console.error(`[Worker] 答复异常: 轮询状态接口失败, 状态码: ${stRes.status}`);
                 continue;
             }
             const st = await stRes.json();
             
             if (!st || st === null || st === "null") {
                 console.log(`[Worker] 收到答复: 探索任务似乎已结束(无状态)。`);
                 finished = true;
                 break;
             }

             console.log(`[Worker] /api/explore/status =`, JSON.stringify(st).substring(0, 500));

             if (st.status === "error" || st.status === "success" || st.status === "completed" || st.status === "stop" || st.status === "idle") {
                 console.log(`[Worker] 收到最终答复: 任务最终状态发现! status: ${st.status}`);
                 finished = true;
                 break;
             }
             
             // Still running
             let currentStep = st.steps && st.steps.length > 0 ? st.steps[st.steps.length - 1].msg : '未知阶段';
             console.log(`[Worker] 任务进行中 -> 当前操作: ${currentStep}, 目标: ${st.target || '未知'}`);
             // Keep worker running and printing logs
           } catch(pollErr) {
             console.error(`[Worker] 问询过程出错:`, pollErr.message);
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
