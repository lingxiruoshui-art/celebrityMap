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
        
        console.log(`[Worker] 已发起触发请求, 准备读取响应流...`);
        
        let finished = false;
        const targetHost = new URL(targetUrl).origin;

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

        console.log(`[Worker] 开始每 5 秒轮询任务执行状态...`);

        while (!finished) {
           await new Promise(r => setTimeout(r, 5000));
           if (finished) break; // Check again in case consumeStream finished it

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
