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
        
        const startResponseData = await response.json().catch(() => ({}));

        if (startResponseData.status === "skipped" || startResponseData.isEmpty) {
            console.warn(`[Worker] 任务跳过或无法开始:`, startResponseData.message);
            return;
        }

        if (startResponseData.status === "started") {
            console.log(`[Worker] 成功启动状态机:`, startResponseData.message);
        }

        let finished = false;
        const targetHost = new URL(targetUrl).origin;

        console.log(`[Worker] 开始逐步步进任务状态机...`);

        while (!finished) {
           try {
             console.log(`[Worker] 发起请求: 驱动下一步骤...`);
             const stepRes = await fetch(`${targetHost}/api/explore/step`, {
                 method: "POST",
                 headers: {
                     "User-Agent": "Cloudflare-Cron-Worker",
                     "x-admin-password": secret
                 }
             });
             
             if (!stepRes.ok) {
                 console.error(`[Worker] 步进接口失败, 状态码: ${stepRes.status}`);
                 let text = await stepRes.text().catch(()=>"");
                 console.error(`[Worker] 错误信息: ${text}`);
                 break;
             }
             const st = await stepRes.json();
             
             if (!st || st === null || st.error) {
                 console.log(`[Worker] 收到答复: 任务中断或出现错误:`, st?.error || "未知");
                 finished = true;
                 break;
             }

             console.log(`[Worker] /api/explore/step 结果: status=${st.status}, phase=${st.phase || 'N/A'}`);

             if (st.status === "success" || st.status === "completed" || st.status === "stop" || st.status === "idle" || st.status === "error") {
                 console.log(`[Worker] 收到最终答复: 任务完成! status: ${st.status}`);
                 finished = true;
                 break;
             }
             
             // Still running, proceed immediately or wait a bit
             // 状态机每次只做一小块，不会超时，所以我们可以立即开始下一步
           } catch(pollErr) {
             console.error(`[Worker] 步进过程出错:`, pollErr.message);
             break; // don't loop infinitely on hard network errors
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
