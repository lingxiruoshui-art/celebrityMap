import { app } from "./app.ts";
import { initExplorationState, doFinalizeInsert } from "./exploreStep.ts";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    let res = await app.fetch(request, env, ctx);
    if ((res.status === 404 || res.status === 405) && env.ASSETS) {
        return env.ASSETS.fetch(request);
    }
    return res;
  }
};
