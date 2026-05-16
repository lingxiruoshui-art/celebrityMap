import { app, getDb, getConfig, setConfig, callAI, addRelationship, fetchMetadataFromWiki, pickTarget } from "./app.ts";
import { advanceExplorationStep, initExplorationState, doFinalizeInsert } from "./exploreStep.ts";
import { ARCHIVE_CORE_PROMPT, ARCHIVE_CORE_SCHEMA, ARCHIVE_EXTRA_PROMPT, ARCHIVE_EXTRA_SCHEMA } from "./services/aiService.ts";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    let res = await app.fetch(request, env, ctx);
    if ((res.status === 404 || res.status === 405) && env.ASSETS) {
        return env.ASSETS.fetch(request);
    }
    return res;
  },

  async scheduled(event: any, env: any, ctx: any) {
    console.log(`[Cloudflare Pages - Scheduled] 定时任务触发.`);
    const c = { env };
    const db = await getDb(c);

    const intervalEnabled = await getConfig(db, "cron_interval_enabled", "false") === "true";
    if (!intervalEnabled) {
        console.log("[Scheduled] 后台自动探索未开启");
        return;
    }

    const now = Date.now();
    const lastTrigger = await getConfig(db, "last_cron_trigger_time", "");
    if (lastTrigger) {
        const lastTime = parseInt(lastTrigger);
        const hours = parseInt(await getConfig(db, "cron_interval_hours", "0"));
        const mins = parseInt(await getConfig(db, "cron_interval_minutes", "0"));
        const intervalMs = (hours * 3600 + mins * 60) * 1000;
        
        if (now - lastTime < intervalMs) {
            console.log(`[Scheduled] Interval not reached. Skip.`);
            return;
        }
    }

    // 收到下一次触发任务时将上次的探索结果入库
    try {
        const pendingResultStr = await getConfig(db, "pending_auto_result", "null");
        if (pendingResultStr !== "null") {
            const pendingParams = JSON.parse(pendingResultStr);
            console.log(`[Scheduled] 正在将上次的探索结果入库: ${pendingParams.finalName}`);
            await doFinalizeInsert(db, pendingParams.finalName, pendingParams.personData, pendingParams.wikiMeta, c, addRelationship, null);
            await setConfig(db, "pending_auto_result", "null");
        }
    } catch(e) {
        console.error("[Scheduled] 上次结果入库失败", e);
    }

    console.log(`[Scheduled] 间隔满足，发送 Queue 消息发起探索...`);
    if (env.EXPLORE_QUEUE) {
      await env.EXPLORE_QUEUE.send({ type: 'auto' });
      await setConfig(db, "last_cron_trigger_time", String(now));
    } else {
      console.error("[Scheduled] 未绑定 EXPLORE_QUEUE");
    }
  },

  async queue(batch: any, env: any, ctx: any) {
    console.log(`[Cloudflare Pages - Queue] 收到 ${batch.messages.length} 条队列消息`);
    const c = { env };
    const db = await getDb(c);

    for (const msg of batch.messages) {
      try {
        const data = msg.body as any;
        const targetName = data.targetName || null;
        let reqSource = data.reqSource || 'explorer';
        if (data.type === 'auto') reqSource = 'auto';
        const clientTaskId = data.taskId || Date.now();

        // 检查全局是否有探索正在运行
        let currentStr = await getConfig(db, "explore_state", "null");
        if (currentStr !== "null") {
            const current = JSON.parse(currentStr);
            const isStale = current.status === 'running' && (!current.lastHeartbeat || (Date.now() - current.lastHeartbeat > 300000));
            if (current.status === 'running' && !isStale) {
                console.log(`[Queue] 探索正在进行中，跳过消息:`, data);
                msg.ack();
                continue;
            }
        }

        let runTarget = targetName;
        if (data.type === 'auto' && !runTarget) {
            const { targetName: picked, isEmpty } = await pickTarget(db);
            if (isEmpty || !picked) {
                console.log(`[Queue] 自动挑选失败，无人物可探索`);
                msg.ack();
                continue;
            }
            runTarget = picked;
        }

        if (!runTarget) {
            msg.ack();
            continue;
        }

        console.log(`[Queue] 初始化探索状态机: target=${runTarget}, source=${reqSource}, taskId=${clientTaskId}`);
        await initExplorationState(db, getConfig, setConfig, runTarget, reqSource, clientTaskId);

        let isDone = false;
        while (!isDone) {
            let stateStr = await getConfig(db, "explore_state", "null");
            if (stateStr !== "null") {
                const state = JSON.parse(stateStr);
                state.lastHeartbeat = Date.now();
                await setConfig(db, "explore_state", JSON.stringify(state));
            }

            console.log(`[Queue] 正在推进 AI 探索环节 (Phase: ${JSON.parse(stateStr || '{}').phase || 'initial'})...`);
            const state = await advanceExplorationStep(
                db, callAI, getConfig, setConfig, addRelationship,
                ARCHIVE_CORE_PROMPT, ARCHIVE_CORE_SCHEMA, ARCHIVE_EXTRA_PROMPT, ARCHIVE_EXTRA_SCHEMA,
                fetchMetadataFromWiki, c, true
            );
            
            if (state.status === "success" || state.status === "error" || state.status === "idle") {
                console.log(`[Queue] 任务 (taskId=${clientTaskId}, target=${runTarget}) 探索执行结束: 状态=${state.status}`);
                isDone = true;
            }
        }

        msg.ack();
      } catch (err: any) {
        console.error(`[Queue] 执行异常:`, err);
        msg.ack(); 
      }
    }
  }
};
