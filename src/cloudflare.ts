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
  }
};
