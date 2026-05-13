export interface DatabaseAdapter {
  prepare(sql: string): StatementAdapter;
  exec(sql: string): Promise<void>;
  pragma(sql: string): void;
}

export interface StatementAdapter {
  all<T = any>(...params: any[]): Promise<T[]>;
  get<T = any>(...params: any[]): Promise<T | undefined>;
  run(...params: any[]): Promise<{ changes: number; lastInsertRowid: number | bigint }>;
}

// Cloudflare D1 implementation
export class D1DatabaseAdapter implements DatabaseAdapter {
  constructor(private d1: any) {}

  prepare(sql: string): StatementAdapter {
    const stmt = this.d1.prepare(sql);
    return {
      all: async (...params) => {
        const res = await stmt.bind(...params).all();
        return res.results;
      },
      get: async (...params) => {
        return await stmt.bind(...params).first();
      },
      run: async (...params) => {
        const res = await stmt.bind(...params).run();
        return { changes: res.meta.changes, lastInsertRowid: res.meta.last_row_id };
      }
    };
  }

  async exec(sql: string): Promise<void> {
    await this.d1.exec(sql);
  }

  pragma(sql: string): void {
  }
}
