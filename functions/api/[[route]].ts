import { handle } from "hono/cloudflare-pages";
import { app } from "../../src/app.ts";

export const onRequest = handle(app);
