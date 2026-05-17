export interface ExploreState {
  status: "idle" | "running" | "success" | "error";
  subStatus?: "queued" | "processing" | "syncing" | null;
  phase: "init" | "ai_core" | "ai_extra" | "finalize";
  lastHeartbeat?: number;
  pulse?: number;
  taskId?: number;
  target: string;
  source?: string;
  logs: { timestamp: string; msg: string; type: string; data?: any }[];
  steps: { msg: string; status: string; startTime?: number }[];
  path: any[] | null;
  newArrivals: string[];
  error: string | null;
  
  // Pipeline data
  wikiMeta?: any;
  coreData?: any;
  extraData?: any;
  sampleNames?: string;
}
