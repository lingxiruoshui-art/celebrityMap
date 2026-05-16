// Cloudflare Worker: worker/cron.js
export default {
  async fetch(request, env, ctx) {
    return new Response("Cron worker 运行正常！此 Worker 定期获取任务并通过 Queue 处理。", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const targetUrl = env.CRON_TARGET_URL;
    const secret = env.CRON_SECRET;
    
    console.log(`[Worker] 定时任务触发. URL: ${targetUrl || "未配置"}`);

    if (!targetUrl || !secret) {
      console.error("[Worker] 错误: 未配置环境变量 CRON_TARGET_URL 或 CRON_SECRET");
      return;
    }

    try {
      const origin = new URL(targetUrl).origin;
      const getUrl = `${origin}/api/cron/get-target?secret=${encodeURIComponent(secret)}`;
      
      console.log(`[Worker] 正在发送请求获取参数: ${getUrl}`);
      const response = await fetch(getUrl, { 
        method: "POST",
        headers: { "User-Agent": "Cloudflare-Cron-Worker" }
      });
      
      const payload = await response.json().catch(()=>({}));
      console.log(`[Worker] 返回参数: ${JSON.stringify(payload)}`);
      
      if (payload && payload.status === "success" && payload.targetName) {
          if (env.EXPLORE_QUEUE) {
              console.log(`[Worker] 获取参数成功，正在通过 Queue 分发任务: ${payload.targetName}, taskId: ${payload.taskId}`);
              await env.EXPLORE_QUEUE.send({ targetName: payload.targetName, taskId: payload.taskId });
              console.log(`[Worker] 任务已成功提交到 Queue.`);
          } else {
              console.error(`[Worker] 错误: 环境变量 EXPLORE_QUEUE 未绑定，无法投递到 Queue`);
          }
      } else {
          console.log(`[Worker] 自动任务跳过或无任务可做。`);
      }
    } catch (e) {
      console.error(`[Worker] 请求执行异常:`, e.stack || e.message);
    }
  },
  
  async queue(batch, env, ctx) {
      console.log(`[Worker Queue] 收到 ${batch.messages.length} 条后台队列探索任务`);
      const targetUrl = env.CRON_TARGET_URL;
      const secret = env.CRON_SECRET;
      
      if (!targetUrl || !secret) {
          console.error("[Worker Queue] 错误: 缺少必要的环境变量");
          return;
      }
      
      const origin = new URL(targetUrl).origin;
      
      for (const msg of batch.messages) {
          try {
              const { targetName, taskId } = msg.body;
              if (!targetName) {
                  msg.ack();
                  continue;
              }
              
              console.log(`\n[Worker Queue] =======================================`);
              console.log(`[Worker Queue] 开始处理探索任务: target=${targetName}, taskId=${taskId}`);
              
              let isDone = false;
              let finalState = null;
              
              while (!isDone) {
                  console.log(`[Worker Queue] 调用 /explore/step 推进进度...`);
                  const stepUrl = `${origin}/explore/step`;
                  
                  const stepRes = await fetch(stepUrl, {
                      method: "POST",
                      headers: { 
                          "Content-Type": "application/json",
                          "x-admin-password": secret,
                          "User-Agent": "Cloudflare-Cron-Queue-Worker"
                      }
                  });
                  
                  if (!stepRes.ok) {
                      const text = await stepRes.text().catch(()=>"");
                      console.error(`[Worker Queue] explore step fail, HTTP code: ${stepRes.status}, Response: ${text}`);
                      break;
                  }
                  
                  const state = await stepRes.json();
                  console.log(`[Worker Queue] Step 返回结果 -> target: ${state.target}, status: ${state.status}, phase: ${state.phase}`);
                  
                  if (state.status === "success" || state.status === "error" || state.status === "idle") {
                      isDone = true;
                      finalState = state;
                  }
              }
              
              if (finalState) {
                  console.log(`[Worker Queue] 任务彻底处理完毕，发送状态结果到 pages/function...`);
                  const notifyUrl = `${origin}/api/cron/notify-result?secret=${encodeURIComponent(secret)}`;
                  const notifyRes = await fetch(notifyUrl, {
                      method: "POST",
                      headers: {
                          "Content-Type": "application/json",
                          "x-admin-password": secret,
                          "User-Agent": "Cloudflare-Cron-Queue-Worker"
                      },
                      body: JSON.stringify({ targetName, result: finalState })
                  });
                  console.log(`[Worker Queue] 结果回传 HTTP Code: ${notifyRes.status}`);
              } else {
                  console.log(`[Worker Queue] 未能收到明确的最终状态.`);
              }
              
              msg.ack();
              console.log(`[Worker Queue] 确认 (ack) 队列消息完成: ${targetName}`);
          } catch (e) {
              console.error(`[Worker Queue] 处理队列项时发生异常:`, e.stack || e.message);
          }
      }
  }
};
