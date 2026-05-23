import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import fs from "fs";
import { getRequestListener } from "@hono/node-server";
import { app as honoApp } from "./src/app.ts";
import Database from "better-sqlite3";
import type { DatabaseAdapter, StatementAdapter } from "./src/db.ts";

dotenv.config();

// Fallback to .env.example only if not in production and variables are missing
if (process.env.NODE_ENV !== "production") {
  const envExamplePath = path.join(process.cwd(), ".env.example");
  if (fs.existsSync(envExamplePath)) {
    const exampleConfig = dotenv.parse(fs.readFileSync(envExamplePath));
    for (const k in exampleConfig) {
      if (!process.env[k] || process.env[k] === "") {
        process.env[k] = exampleConfig[k];
      }
    }
  }
}

// Node.js implementation using better-sqlite3
class NodeDatabaseAdapter implements DatabaseAdapter {
  private db: Database.Database | null = null;
  private filename: string;

  constructor(filename: string) {
    this.filename = filename;
    try {
      this.db = new Database(filename);
      console.log(`Database connected: ${filename}`);
    } catch (e) {
      console.error(`Failed to connect to database ${filename}:`, e);
    }
  }

  private getDb() {
    if (!this.db) throw new Error(`Database not connected: ${this.filename}`);
    return this.db;
  }

  prepare(sql: string): StatementAdapter {
    const db = this.getDb();
    const stmt = db.prepare(sql);
    return {
      all: async <T>(...params: any[]) => stmt.all(...params) as T[],
      get: async <T>(...params: any[]) => stmt.get(...params) as T | undefined,
      run: async (...params: any[]) => {
        const result = stmt.run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      }
    };
  }

  async exec(sql: string): Promise<void> {
    this.getDb().exec(sql);
  }

  pragma(sql: string): void {
    this.getDb().pragma(sql);
  }
}

let dbAdapter: NodeDatabaseAdapter;
try {
  dbAdapter = new NodeDatabaseAdapter("celebrity_graph.sqlite");
  dbAdapter.pragma("journal_mode = WAL");
} catch (e) {
  console.error("Critical error: Database adapter failed, using dummy adapter");
  // @ts-ignore
  dbAdapter = {
    prepare: () => ({ all: async () => [], get: async () => undefined, run: async () => ({ changes: 0, lastInsertRowid: 0 }) }),
    exec: async () => {},
    pragma: () => {}
  };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Hono handler for /api
  const apiHandler = getRequestListener((request) => {
    return honoApp.fetch(request, { 
      ...process.env, 
      DB_ADAPTER: dbAdapter 
    });
  });

  // Hono API Routes
  app.all("/api/*", async (req, res) => {
    // Ensure the URL passed to Hono is a robust relative path starting with /api
    let targetUrl = req.originalUrl || req.url || "";
    if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
      try {
        const parsed = new URL(targetUrl);
        targetUrl = parsed.pathname + parsed.search;
      } catch (e) {
        // Use as is if invalid
      }
    }
    
    // Clean up any duplicate slashes while preserving query parameters
    const [pathPart, queryPart] = targetUrl.split("?");
    targetUrl = pathPart.replace(/\/+/g, "/") + (queryPart !== undefined ? "?" + queryPart : "");
    
    req.url = targetUrl;
    console.log(`[API Request] ${req.method} ${req.url}`);
    try {
      await apiHandler(req, res);
    } catch (e) {
      console.error("[Hono Bridge Error]:", e);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Internal Hono Bridge Error", 
          details: e instanceof Error ? e.message : String(e) 
        });
      }
    }
  });

  // Explicitly handle /api (no trailing slash)
  app.all("/api", (req, res) => {
    res.status(404).json({ error: "API Root Not Found. Use /api/health or other endpoints." });
  });

  // Health check for Express itself
  app.get("/express-health", (req, res) => {
    res.json({ status: "alive" });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.setTimeout(310000);
}

startServer();
