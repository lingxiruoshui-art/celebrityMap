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
  const request = new Request("https://internal/api/explore/start", {
    method: "POST",
    headers: { 
        "Content-Type": "application/json",
        "x-admin-password": ADMIN_PASSWORD 
    },
    body: JSON.stringify({ 
        isAdmin: true
    })
  });
  
  // This invokes the Hono app directly with the request
  ctx.waitUntil(app.fetch(request, env, ctx));
};
