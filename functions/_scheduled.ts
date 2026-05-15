/// <reference types="@cloudflare/workers-types" />
import { app } from "../src/app";

// Cloudflare Workers Scheduled Task Trigger
export const scheduled = async (
  controller: ScheduledController,
  env: any, // Bindings
  ctx: ExecutionContext
) => {
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD || "admin";
  
  // Directly trigger the internal API endpoint for cron jobs
  // We use the worker's own request handler
  // Use the secret required by the /api/cron endpoint
  const request = new Request("https://internal/api/cron?secret=update_celeb", {
    method: "POST",
    headers: { 
        "Content-Type": "application/json",
        "x-admin-password": ADMIN_PASSWORD 
    }
  });
  
  // This invokes the Hono app directly with the request
  ctx.waitUntil(Promise.resolve(app.fetch(request, env, ctx)));
};
