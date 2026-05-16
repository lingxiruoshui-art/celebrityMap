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
        
        let startResponseData;
        try {
          startResponseData = JSON.parse(text);
          if (startResponseData.status === "skipped" || startResponseData.isEmpty) {
            console.warn(`[Worker] 任务跳过或无法开始: ${startResponseData.message}`);
            return;
          }
          console.log(`[Worker] 成功触发任务:`, startResponseData.message || startResponseData);
        } catch(e) {
          console.log(`[Worker] 原始响应内容无法解析: ${text.substring(0, 200)}`);
          return;
        }

        // 持续轮询直至完成或报错
        const targetHost = new URL(targetUrl).origin;
        console.log(`[Worker] 开始每 10 秒轮询任务执行状态...`);
        let finished = false;

        while (!finished) {
           await new Promise(r => setTimeout(r, 10000));
           try {
             const stRes = await fetch(`${targetHost}/api/explore/status?_v=${Date.now()}`);
             if (!stRes.ok) {
                 console.error(`[Worker] 轮询状态接口失败:`, stRes.status);
                 continue;
             }
             const st = await stRes.json();
             
             if (!st || st === null || st === "null") {
                 console.log(`[Worker] 探索任务似乎已结束(无状态)。`);
                 finished = true;
                 break;
             }

             if (st.status === "error" || st.status === "completed" || st.status === "stop" || st.status === "idle") {
                 console.log(`[Worker] 任务最终状态发现! status: ${st.status}, message: ${st.error || st.msg || "完成"}`);
                 finished = true;
                 break;
             }
             
             // Still running
             console.log(`[Worker] 任务进行中 -> 阶段: ${st.stage || '未知'}, 信息: ${st.msg || '探索进行中...'}`);
             // Keep worker running and printing logs
           } catch(pollErr) {
             console.error(`[Worker] 轮询出错:`, pollErr.message);
           }
        }
        
        console.log(`[Worker] 流程彻底结束，退出。`);
      } catch (e) {
        console.error(`[Worker] 请求执行异常:`, e.message);
      }
    };

    ctx.waitUntil(deliver());
  }
};
