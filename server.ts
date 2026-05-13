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
  private db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
  }

  prepare(sql: string): StatementAdapter {
    const stmt = this.db.prepare(sql);
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
    this.db.exec(sql);
  }

  pragma(sql: string): void {
    this.db.pragma(sql);
  }
}

const db = new NodeDatabaseAdapter("celebrity_graph.sqlite");
db.pragma("journal_mode = WAL");

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Mount Hono app to /api
  app.all("/api/*", (req, res) => {
    // getRequestListener adapts the Node.js req/res to Web Standards Request for Hono
    getRequestListener((request) => {
      // Pass the fully constructed environment object to Hono
      return honoApp.fetch(request, { 
        ...process.env, 
        DB_ADAPTER: db 
      });
    })(req, res);
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
