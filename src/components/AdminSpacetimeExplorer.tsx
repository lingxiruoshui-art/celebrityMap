import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { X, Search, ChevronRight, User, Loader2, Sparkles, AlertCircle, Zap, ChevronDown, ChevronUp, RefreshCw, Save, CheckCircle, Layers, Download } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGemini } from "../services/aiService";

export interface SpacetimeExplorerHandle {
  start: (overrideSource?: string, overrideTarget?: string) => void;
  clear: () => void;
}

interface SpacetimeExplorerProps {
  onClose: () => void;
  onRefreshArchive: () => void;
  onSelectPerson: (id: number, name?: string) => void;
  onPathFound?: (path: Step[] | null) => void;
  isInline?: boolean;
  isPane?: boolean;
  initialSource?: string;
  initialTarget?: string;
  autoStart?: boolean;
  hideInputs?: boolean;
  hideHeader?: boolean;
  isAdmin?: boolean;
  allowAdminControls?: boolean;
  showLogs?: boolean;
  peopleNames?: string[];
}

interface Step {
  name: string;
  type?: string;
}

const PendingTimerMessage = ({ msg, startTime }: { msg: string, startTime?: number }) => {
  const [seconds, setSeconds] = useState(() => {
    if (startTime) {
      const diff = Math.floor((Date.now() - startTime) / 1000);
      return diff > 0 ? diff : 0;
    }
    return 0;
  });
  
  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const getStatusTip = () => {
    if (seconds < 10) return "时空扰动稳定中...";
    if (seconds < 25) return "AI 专家正在翻阅历史长河，寻找跨维度的交点...";
    if (seconds < 45) return "正在进行逻辑考古以建立链条，这通常需要一些深度思考...";
    if (seconds < 70) return "思维火花碰撞中！AI 正在试图绕过时间悖论，请稍候...";
    if (seconds < 100) return "档案数据博大精深，编织链路时 AI 正在为您精选最关键路径...";
    return "跨时空链路极度复杂，正在进行最后的档案拼合，即将揭晓...";
  };
  
  return (
    <span className="flex flex-col">
      <span className="flex items-center gap-2">
        {msg}
      </span>
      <span className="mt-1 text-[12px] opacity-60 font-normal italic animate-pulse text-indigo-500/70">
        {getStatusTip()}
      </span>
    </span>
  );
};

export default forwardRef<SpacetimeExplorerHandle, SpacetimeExplorerProps>(function AdminSpacetimeExplorer({ 
  onClose, 
  onRefreshArchive, 
  onSelectPerson, 
  onPathFound, 
  isInline,
  isPane = false,
  initialSource = "",
  initialTarget = "",
  autoStart = false,
  hideInputs = false,
  hideHeader = false,
  isAdmin = false,
  allowAdminControls = false,
  showLogs = false,
  peopleNames = []
}, ref) {
  const [source, setSource] = useState(() => initialSource || "");
  const [target, setTarget] = useState(() => initialTarget || "");

  useImperativeHandle(ref, () => ({
    start: (overrideSource?: string, overrideTarget?: string) => {
      console.log("SpacetimeExplorer start called with:", source, target, "overrides:", overrideSource, overrideTarget);
      setIsCollapsed(false);
      handleSearch(overrideSource, overrideTarget);
    },
    clear: () => {
      clearResults();
    }
  }));

  useEffect(() => {
    if (initialSource) setSource(initialSource);
  }, [initialSource]);

  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);

  useEffect(() => {
    const fallbackTimer = setTimeout(() => setHasInitialCheckDone(true), 3000);
    return () => clearTimeout(fallbackTimer);
  }, []);

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isLoading) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isLoading]);
  const [hasInitialCheckDone, setHasInitialCheckDone] = useState(false);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [targetOptions, setTargetOptions] = useState<string[]>([]);
  const [isSourceFocused, setIsSourceFocused] = useState(false);
  const [isTargetFocused, setIsTargetFocused] = useState(false);
  
  const filteredSourceNames = peopleNames
      .filter((n) => source && n.toLowerCase().includes(source.toLowerCase()) && n.toLowerCase() !== source.toLowerCase())
      .slice(0, 8);
  const filteredTargetNames = peopleNames
      .filter((n) => target && n.toLowerCase().includes(target.toLowerCase()) && n.toLowerCase() !== target.toLowerCase())
      .slice(0, 8);

  const [path, setPath] = useState<Step[] | null>(null);
  const [subStatus, setSubStatus] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newArrivals, setNewArrivals] = useState<string[]>([]);
  const [error, setError] = useState<React.ReactNode | string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => hideHeader ? false : true);
  const [detailedLogs, setDetailedLogs] = useState<{timestamp: string, msg: string, data?: any, type: string}[]>([]);
  const [searchSteps, setSearchSteps] = useState<{msg: string, status: 'pending' | 'success' | 'error', startTime?: number}[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [metadata, setMetadata] = useState<{
    categories: string[], 
    existingNames: string, 
    activeProvider: string,
    geminiModelId?: string, 
    geminiApiKey?: string,
    aliyunModelId?: string,
    aliyunApiKey?: string
  } | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);
  const isLogsAtBottomRef = useRef(true);
  const pollStatusRef = useRef(false);
  const hasLoadedResultRef = useRef(false);
  const hasAutoExpandedRunningRef = useRef(false);
  const isResettingRef = useRef(false);
  const publicSearchAbortControllerRef = useRef<AbortController | null>(null);
  const lastStreamPulseRef = useRef<number>(Date.now());
  const lastActivityRef = useRef<number>(Date.now());
  const activeSearchTaskIdRef = useRef<number | null>(null);
  const [lastActivityTime, setLastActivityTime] = useState<number | null>(null);
  const [pulseActive, setPulseActive] = useState(true);

  // Monitor activity to update respiratory light status
  useEffect(() => {
    if (!isLoading) return;
    
    const interval = setInterval(() => {
      const now = Date.now();
      const diff = now - lastActivityRef.current;
      // If no activity for 25 seconds, consider it "stale" (red light)
      if (diff > 25000) {
        setPulseActive(false);
      } else {
        setPulseActive(true);
      }
    }, 2000);
    
    return () => clearInterval(interval);
  }, [isLoading]);

  // Provide smooth polling from status payload
  useEffect(() => {
    let _active = true;
    // We rely purely on the SSE stream or data.lastHeartbeat from checkStatus now
    return () => {
      _active = false;
    };
  }, [isLoading]);

  useEffect(() => {
    if (!isAdmin) {
      setHasInitialCheckDone(true);
      return;
    }

    let timer: any;
    let isActive = true;
    const abortController = new AbortController();

    const checkStatus = async () => {
       if (!isActive) return;
       try {
           const headers: any = { "Cache-Control": "no-cache" };
           headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
           
           const cacheBuster = `?t=${Date.now()}`;
           const res = await fetch(`/api/explore/status${cacheBuster}`, { 
             headers,
             signal: abortController.signal
           });
           
           if (!isActive) return;
           
           const contentType = res.headers.get("content-type");
           if (!res.ok || !contentType || !contentType.includes("application/json")) {
               if (res.status === 404) {
                   console.warn("Status endpoint not found (404)");
               } else {
                   const text = await res.text();
                   console.error("Status check failed:", res.status, text.slice(0, 100));
               }
               setHasInitialCheckDone(true);

               if (isActive) timer = setTimeout(checkStatus, 3000);
               return;
           }

           const data = await res.json() as any;
            if (data) {
                if (data.queue) setQueue(data.queue);
                if (data.autoRefillEnabled !== undefined) setIsAutoRefillEnabled(data.autoRefillEnabled);
                if (data.logs) setDetailedLogs(data.logs);
                if (data.steps) setSearchSteps(data.steps);
            }
           
           if (!isActive) return;
           setHasInitialCheckDone(true);

           if (isResettingRef.current) {
               if (isActive) timer = setTimeout(checkStatus, 2000);
               return;
           }

           if (data) {
               if (activeSearchTaskIdRef.current && data.taskId && data.taskId !== activeSearchTaskIdRef.current) {
                   if (data.taskId > activeSearchTaskIdRef.current) {
                       activeSearchTaskIdRef.current = data.taskId;
                       // Do not clear logs here to fulfill "persistent" requirement
                       setSearchSteps([]);
                       setError(null);
                   } else {
                       if (isActive) timer = setTimeout(checkStatus, 3000);
                       return;
                   }
               }
               if (!activeSearchTaskIdRef.current && data.taskId) {
                   activeSearchTaskIdRef.current = data.taskId;
               }
               if (data.lastHeartbeat) {
                   lastActivityRef.current = data.lastHeartbeat;
                   setLastActivityTime(data.lastHeartbeat);
               }
               if (data.status === 'running') {
                   setSubStatus(data.subStatus || null);
                   setTargetName(data.target || null);
                   setQueue(data.queue || []);
                   if (false && allowAdminControls) {
                       if (data.target && source !== data.target) setSource(data.target);
                   } else {
                       if (data.target && target !== data.target) setTarget(data.target);
                   }
                   lastStreamPulseRef.current = Date.now();
                   setIsLoading(true);
                   setError(null);
                   setShowResults(false);
                   setPath(null);
                   setNewArrivals([]);
                   hasLoadedResultRef.current = false;
                   pollStatusRef.current = true; 

                   if (!hasAutoExpandedRunningRef.current) {
                       setIsCollapsed(false);
                       hasAutoExpandedRunningRef.current = true;
                   }
               } else {
                   hasAutoExpandedRunningRef.current = false;
                   
                   if (data.status === 'error') {
                       setError(data.error);
                       setIsLoading(false);
                       pollStatusRef.current = false;
                   } else if (data.status === 'success') {
                       if (!hasLoadedResultRef.current) {
                           setPath(data.path || []);
                           setNewArrivals(data.newArrivals ? data.newArrivals : []);
                           setShowResults(true);
                           setIsLoading(false);
                           pollStatusRef.current = false;
                           hasLoadedResultRef.current = true;
                           if (onPathFound) onPathFound(data.path || []);
                            
                           if (data.newArrivals && data.newArrivals.length > 0) {
                               onRefreshArchive();
                           }
                           
                           if (allowAdminControls || isAdmin) {
                               if (isAutoRefillEnabled && (!data.queue || data.queue.length === 0)) {
                                  // Server proactively handles auto-refill now, no need to trigger from client.
                                  // Just retrieve a random pair for the UI to display in the input box.
                                  handlePickRandomPair(false, true);
                               } else {
                                  // Still pre-fill the input box with a random source if empty
                                  handlePickRandomPair(false, true);
                               }
                           }
                       } else {
                           pollStatusRef.current = false;
                       }
                   } else {
                       setIsLoading(false);
                       pollStatusRef.current = false;
                   }
               }

               if (data.logs && (pollStatusRef.current || isAdmin || hasLoadedResultRef.current)) setDetailedLogs(data.logs);
               if (data.steps && (pollStatusRef.current || isAdmin || hasLoadedResultRef.current)) setSearchSteps(data.steps);
           } else {
               // Data is null: No search active
               setIsLoading(false);
               pollStatusRef.current = false;
               if (hasLoadedResultRef.current) {
                   setPath(null);
                   setShowResults(false);
                   setError(null);
                   setDetailedLogs([]);
                   setSearchSteps([]);
                   hasLoadedResultRef.current = false;
               }
           }
       } catch (e: any) {
         if (e.name === 'AbortError') return;
         console.warn("Status poll error:", e);
         if (isActive) setHasInitialCheckDone(true);
       }
       
       if (isActive) {
           timer = setTimeout(checkStatus, 3000); 
       }
    };
    checkStatus();
    return () => {
      isActive = false;
      clearTimeout(timer);
      abortController.abort();
    };
  }, [isAdmin]);

  useEffect(() => {
    if (logsScrollRef.current && isLogsAtBottomRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [detailedLogs]);

  const handleLogsScroll = () => {
    if (logsScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logsScrollRef.current;
      isLogsAtBottomRef.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 50;
    }
  };
  const loadingIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/metadata")
      .then(res => res.json())
      .then(data => setMetadata(data))
      .catch(err => console.error("Failed to fetch metadata", err));
  }, []);

  const handleStop = async () => {
    if (!isAdmin) {
       if (publicSearchAbortControllerRef.current) {
           publicSearchAbortControllerRef.current.abort();
           publicSearchAbortControllerRef.current = null;
       }
       setIsLoading(false);
       pollStatusRef.current = false;
       hasAutoExpandedRunningRef.current = false;
       if (!path) setError("搜索已中止");
       return;
    }
    const headers: any = { "Content-Type": "application/json" };
    if (isAdmin) headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
    await fetch("/api/explore/stop", { 
      method: "POST", 
      headers
    });
    pollStatusRef.current = false;
    hasAutoExpandedRunningRef.current = false;
    setIsLoading(false);
    if (!path) setError("搜索已由管理员中断。");
  };
  
  const handleDequeue = async (name: string) => {
    if (!isAdmin) return;
    try {
      const headers: any = { "Content-Type": "application/json" };
      headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
      const res = await fetch("/api/explore/dequeue", { 
        method: "POST", 
        headers,
        body: JSON.stringify({ targetName: name })
      });
                    if (res.ok) {
                        // Optimistically update local queue
                        setQueue(prev => prev.filter(q => q !== name));
                        setSearchSteps([{ msg: `[${name}] 已从待入库队列中移除`, status: "success", startTime: Date.now() }]);
                        if (name === targetName) {
                           // Silent stop backend process if it's the current target
                           const stopHeaders: any = { "Content-Type": "application/json" };
                           stopHeaders["x-admin-password"] = localStorage.getItem("admin_password") || "";
                           fetch("/api/explore/stop", { method: "POST", headers: stopHeaders }).catch(e => console.error(e));
                           
                           setTargetName(null);
                           setIsLoading(false);
                        }
                    }
    } catch (e) {
      console.error("Failed to dequeue", e);
    }
  };

  const [isAutoRefillEnabled, setIsAutoRefillEnabled] = useState(false);
  const [adminStats, setAdminStats] = useState<{totalPool: number, archivedPool: number, connectedTotal: number, connectedArchived: number, blacklistCount: number} | null>(null);
  const [isDownloadingBlacklist, setIsDownloadingBlacklist] = useState(false);

  const handleDownloadBlacklist = async () => {
    setIsDownloadingBlacklist(true);
    try {
      const res = await fetch("/api/admin/blacklist", {
        headers: { "x-admin-password": localStorage.getItem("admin_password") || "" }
      });
      if (!res.ok) {
        throw new Error("下载失败");
      }
      const names = await res.json() as string[];
      const text = names.join("\n");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `时空锁死黑名单_${new Date().toISOString().slice(0, 10)}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Failed to download blacklist", e);
    } finally {
      setIsDownloadingBlacklist(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
        const fetchStats = () => {
             fetch("/api/admin/stats", { headers: { "x-admin-password": localStorage.getItem("admin_password") || "" } })
                .then(res => res.json())
                .then(data => setAdminStats(data))
                .catch(err => console.error("Failed to fetch stats", err));
        };
        fetchStats();
        const interval = setInterval(fetchStats, 5000);
        return () => clearInterval(interval);
    }
  }, [isAdmin]);
  
  // Sync auto-refill state with backend
  useEffect(() => {
    if (isAdmin && metadata) {
      setIsAutoRefillEnabled(!!(metadata as any).auto_refill_enabled);
    }
  }, [isAdmin, metadata]);

  const toggleAutoRefill = async (val: boolean) => {
    setIsAutoRefillEnabled(val);
    if (!val) {
      handlePickRandomPair(false, true);
    }
    if (!isAdmin) return;
    try {
      const headers: any = { "Content-Type": "application/json" };
      headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
      await fetch("/api/admin/config", {
        method: "POST",
        headers,
        body: JSON.stringify({ auto_refill_enabled: val })
      });
    } catch (e) {
      console.error("Failed to sync auto-refill setting", e);
    }
  };

  const [isPickingRandom, setIsPickingRandom] = useState(false);

  const handlePickRandomPair = async (autoEnqueue = false, onlyIfEmpty = false) => {
    // Basic guard: don't double-pick
    if (isPickingRandom) return;
    
    // For non-admins or auto-enqueue cases, avoid interrupting active flows
    if (!isAdmin && (isLoading || pollStatusRef.current)) return;
    
    // If auto-enqueuing, only proceed if we aren't already busy with another active process
    if (autoEnqueue && (isLoading || pollStatusRef.current)) return;

    setIsPickingRandom(true);
    
    // Only clear UI states if nothing is currently active/running in foreground
    if (!isLoading && !pollStatusRef.current) {
      setError(null);
      setPath(null);
      // Detailed logs are now persistent rolling
      setSearchSteps([]);
      setShowResults(false);
    }
    
    try {
      if (allowAdminControls || isAdmin) {
        const headers: any = { "Content-Type": "application/json" };
        if (isAdmin) headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
        const res = await fetch("/api/archiver/admin-pick-target", { 
          method: "POST",
          headers
        });
        const data = await res.json() as any;
        if (data.isEmpty) {
          setSource(prev => (onlyIfEmpty && prev) ? prev : "");
          setTarget(prev => (onlyIfEmpty && prev) ? prev : "");
          setError(
            <div className="flex flex-col gap-1 items-center">
              <p className="font-bold">✨ 所有预置及关联人物均已录入</p>
              <p className="text-[12px] opacity-70">系统已穷尽所有已知线索。请手动填入新的人物开启探索之旅。</p>
            </div>
          );
        } else {
          setSource(prev => (onlyIfEmpty && prev) ? prev : (data.targetName || ""));
          setTarget(prev => (onlyIfEmpty && prev) ? prev : "");
          if (autoEnqueue && data.targetName) {
            handleEnqueue(data.targetName);
          }
        }
      } else {
        const res = await fetch("/api/archiver/random-pair");
        const data = await res.json() as any;
        if (data.sourceName && data.targetName) {
          setSource(prev => (onlyIfEmpty && prev) ? prev : data.sourceName);
          setTarget(prev => (onlyIfEmpty && prev) ? prev : data.targetName);
        }
      }
    } catch (e) {
      console.error(e);
      setError("检索随机人物失败，请稍后重试。");
    } finally {
      setIsPickingRandom(false);
    }
  };

  // Always ensure source has a value in admin mode if empty and not active
  useEffect(() => {
    if (allowAdminControls && !source && !isLoading && !pollStatusRef.current && hasInitialCheckDone && !error && !isPickingRandom) {
      // Small delay to ensure any existing state is settled
      const timer = setTimeout(() => {
        if (!source && !isLoading && !pollStatusRef.current && !error && !isPickingRandom) {
          handlePickRandomPair(false, true);
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [allowAdminControls, source, isLoading, hasInitialCheckDone, error, isPickingRandom, handlePickRandomPair]);

  const handleEnqueue = async (overrideName?: string) => {
    const finalTarget = overrideName || source;
    
    if (!finalTarget.trim() || isSubmitting || isPickingRandom) return;

    if (isAdmin) {
      // Keep UI state but don't clear source yet to show what's being added
      setIsCollapsed(false);
      setError(null);
      setPath(null);
      setShowResults(false);
      
      // Update local logs immediately
      setSearchSteps([{ msg: `正在将 [${finalTarget}] 发布至时空任务队列...`, status: "pending", startTime: Date.now() }]);
      
      try {
        const headers: any = { "Content-Type": "application/json" };
        if (isAdmin) headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
        
        setIsSubmitting(true);
        const res = await fetch("/api/explore/enqueue", {
          method: "POST",
          headers,
          body: JSON.stringify({ targetName: finalTarget, isAdmin: true, source: 'explorer' })
        });
        
        if (!res.ok) {
           let errMsg = "归档请求发布失败";
           try {
             const errData = await res.json() as any;
             errMsg = errData.error || errMsg;
           } catch(e) {}
           throw new Error(errMsg);
        }
        
        // Polling will pick up the running status if/when the worker starts
        
        // Immediately clear input to prevent duplicate addition of the same target
        setSource("");
        
        // Successfully enqueued. Now pick the NEXT one
        await handlePickRandomPair();
      } catch (err: any) {
        setError(err.message || "请求发布过程中发生错误。");
        // If it failed, source is empty now anyway, which is safer.
        setSource("");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }
    
    // For non-admin (Public pathfinding), keep it same but rename if needed
    handleSearch(finalTarget);
  };

  const handleSearch = async (overrideSource?: string, overrideTarget?: string) => {
    const finalSource = overrideSource || source;
    const finalTarget = overrideTarget || target;
    
    if (!finalSource.trim() || !finalTarget.trim()) return;
    
    setIsCollapsed(false);
    setIsLoading(true);
    hasLoadedResultRef.current = false;
    hasAutoExpandedRunningRef.current = true;
    setError(null);
    setPath(null);
    setShowResults(false);
    if (onPathFound) onPathFound(null);
    setNewArrivals([]);
    setSearchSteps([]);
    // Rolling logs across searches, do not clear
    setSourceOptions([]);
    setTargetOptions([]);

    setSearchSteps([{ msg: "正在检索时空档案库...", status: "pending", startTime: Date.now() }]);
    
    if (publicSearchAbortControllerRef.current) {
        publicSearchAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    publicSearchAbortControllerRef.current = abortController;

    try {
      const res = await fetch("/api/public/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({ source: finalSource, target: finalTarget })
      });
      
      const contentType = res.headers.get("content-type");
      if (!res.ok || !contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          console.error("Public explore error:", text);
          throw new Error(`搜索失败: ${res.status}`);
      }

      const data = await res.json() as any;
      
      if (!res.ok) {
        if (data.error && (data.error.includes("探索正在进行中") || data.error.includes("重置状态"))) {
          setError(
            <div className="flex flex-col gap-2">
              <p>{data.error || "探索正在进行中"}</p>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  clearResults(true);
                }}
                className="mt-2 text-[12px] font-bold py-1.5 px-3 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors w-fit border border-indigo-200"
              >
                立即强制重置状态
              </button>
            </div>
          );
          setSearchSteps([{ msg: "时空探索协议正在执行中", status: "error" }]);
          setIsLoading(false);
          return;
        }
         throw new Error(data.error || "搜索失败");
      }

      if (data.needsSelection) {
         setError("发现多个匹配项，请重新选择准确的人物名");
         if (data.sourceOptions && data.sourceOptions.length > 0) setSourceOptions(data.sourceOptions);
         if (data.targetOptions && data.targetOptions.length > 0) setTargetOptions(data.targetOptions);
         setSearchSteps([{ msg: "需要进一步确认人物身份", status: "error" }]);
         setIsLoading(false);
         return;
      }

      if (data.status === 'success') {
         setSearchSteps([
            { msg: "已从现有网络中找到时空连通路径", status: "success" }
         ]);
         setSource(data.sourceName);
         setTarget(data.targetName);
         setPath(data.path);
         setShowResults(true);
         hasLoadedResultRef.current = true;
         if (onPathFound) onPathFound(data.path);
      } else {
         throw new Error(data.error || "搜索失败");
      }
    } catch (err: any) {
       if (err.name === 'AbortError') {
           // Handle gracefully
       } else {
           setError(err.message);
           setSearchSteps([{ msg: err.message, status: "error" }]);
       }
    } finally {
       pollStatusRef.current = false;
       hasAutoExpandedRunningRef.current = false;
       setIsLoading(false);
    }
  };

  useEffect(() => {
     if (autoStart && initialSource && initialTarget) {
       handleSearch();
     }
     
     if (hasInitialCheckDone && isAdmin && !initialSource && !initialTarget && !source && !target && !isLoading && !pollStatusRef.current) {
        handlePickRandomPair(false, true);
     }
  }, [hasInitialCheckDone, isAdmin, autoStart, initialSource, initialTarget]);

  const clearResults = async (forceServerReset = false) => {
    const isJustRejectionError = typeof error === 'string' && (error.includes("探索正在进行中") || error.includes("重置状态"));
    
    isResettingRef.current = true;
    setPath(null);
    setShowResults(false);
    setIsLoading(false);
    if (onPathFound) onPathFound(null);
    setSearchSteps([]);
    // Detailed logs are persistent
    setError(null);
    setNewArrivals([]);
    hasAutoExpandedRunningRef.current = false;
    
    if ((isAdmin && !isJustRejectionError) || forceServerReset) {
      try {
        const headers: any = {};
        if (isAdmin) headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
        await fetch("/api/explore/reset", { method: "POST", headers });
      } catch (e) {
        console.warn("Reset failed:", e);
      }
    }
    
    isResettingRef.current = false;
  };

  const content = (
    <div className={`flex flex-col flex-1 min-h-0 w-full overflow-hidden transition-all duration-300 ${!isCollapsed ? (isInline ? "p-0" : "p-6") : "p-0"}`}>
      {!isCollapsed && (
        <div className={`flex-1 flex flex-col lg:flex-row items-stretch overflow-hidden min-h-0 bg-white`}>
            {/* Main Controls & Results Column (Responsive Width - Now on Left) */}
          <div className={`${showLogs ? "w-full lg:w-[360px] xl:w-[400px] lg:border-r border-slate-100 bg-slate-50/20 shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.05)_inset]" : "w-full max-w-[440px] mx-auto"} flex flex-col flex-1 lg:flex-none lg:shrink-0 overflow-hidden min-h-0 max-h-full`}>
              <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5 sm:px-6 sm:pb-6 space-y-4">
                {!hideInputs && (
                  <div className="space-y-3 pt-4 pb-6 border-b border-slate-100 mb-2">
                    {allowAdminControls && (
                      <div className="flex items-center justify-between py-1 border-b border-slate-100 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${isAutoRefillEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                          <span className="text-[12px] font-black text-slate-500 uppercase tracking-wider">自动任务补位</span>
                        </div>
                        <button 
                          onClick={() => toggleAutoRefill(!isAutoRefillEnabled)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isAutoRefillEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
                        >
                          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isAutoRefillEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </div>
                    )}
                    {allowAdminControls ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex gap-2 items-center">
                          <div className="relative group flex-1">
                            <input 
                              type="text"
                              value={source}
                              onChange={(e) => setSource(e.target.value)}
                              onFocus={() => setIsSourceFocused(true)}
                              onBlur={() => setTimeout(() => setIsSourceFocused(false), 200)}
                              placeholder={isAutoRefillEnabled ? "自动补位已开启..." : "输入人名并按回车入队..."}
                              disabled={isPickingRandom || isAutoRefillEnabled}
                              className={`w-full pl-8 pr-10 py-2 border rounded-xl text-[12px] focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 outline-none transition-all font-bold placeholder:text-slate-300 shadow-sm ${isPickingRandom || isAutoRefillEnabled ? 'bg-indigo-50/50 border-indigo-200 text-indigo-700/50 cursor-not-allowed opacity-70' : 'bg-slate-50 border-slate-200'}`}
                              onKeyDown={(e) => e.key === 'Enter' && handleEnqueue()}
                            />
                            <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                            
                            <button 
                              onClick={() => handlePickRandomPair()}
                              disabled={isPickingRandom || isAutoRefillEnabled}
                              title="手动刷新推荐人物"
                              className={`absolute right-3 top-2.5 transition-colors ${isPickingRandom || isAutoRefillEnabled ? 'text-slate-200 cursor-not-allowed' : 'text-slate-300 hover:text-indigo-500'}`}
                            >
                              <RefreshCw className={`w-3.5 h-3.5 ${isPickingRandom ? 'animate-spin text-indigo-500' : ''}`} />
                            </button>
                            
                            {/* Autocomplete Dropdown */}
                            <AnimatePresence>
                              {isSourceFocused && filteredSourceNames.length > 0 && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  className="absolute top-full left-0 z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden py-1"
                                >
                                  {filteredSourceNames.map(name => (
                                    <button
                                      key={name}
                                      onClick={() => { setSource(name); setIsSourceFocused(false); handleEnqueue(name); }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] font-medium hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                    >
                                      {name}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          <button 
                            onClick={() => handleEnqueue()}
                            disabled={isPickingRandom || isSubmitting || !source.trim() || !hasInitialCheckDone || queue.length >= 20 || isAutoRefillEnabled}
                            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white h-[38px] px-4 text-[12px] font-black rounded-xl transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-1.5 active:scale-[0.98] group whitespace-nowrap"
                          >
                            {isSubmitting || !hasInitialCheckDone || isPickingRandom ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : queue.length >= 20 ? (
                              <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                            ) : (
                              <CheckCircle className="w-3.5 h-3.5 group-hover:animate-pulse" />
                            )}
                            <span>{queue.length >= 20 ? "队列已满" : (isSubmitting ? "发布中..." : "加入队列")}</span>
                          </button>
                        </div>
                      </div>
                    ) : (

                      <div className="flex flex-col sm:grid sm:grid-cols-2 md:flex md:flex-col gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono">起点人物</label>
                          <div className="relative group">
                            <input 
                              type="text"
                              value={source}
                              onChange={(e) => setSource(e.target.value)}
                              onFocus={() => setIsSourceFocused(true)}
                              onBlur={() => setTimeout(() => setIsSourceFocused(false), 200)}
                              placeholder="苏格拉底"
                              disabled={isLoading}
                              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 focus:bg-white outline-none transition-all font-bold placeholder:text-slate-300 shadow-sm disabled:opacity-50"
                            />
                            <User className="absolute left-3 top-2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                            
                            {/* Autocomplete Dropdown */}
                            <AnimatePresence>
                              {isSourceFocused && filteredSourceNames.length > 0 && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  className="absolute top-full left-0 z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden py-1"
                                >
                                  {filteredSourceNames.map(name => (
                                    <button
                                      key={name}
                                      onClick={() => { setSource(name); setIsSourceFocused(false); }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] font-medium hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                    >
                                      {name}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                          {sourceOptions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1 border border-indigo-100 bg-indigo-50 p-1.5 rounded-lg">
                              <span className="text-[12px] text-slate-500 w-full mb-0.5">您是指：</span>
                              {sourceOptions.map(opt => (
                                <button key={opt} onClick={() => { setSource(opt); setSourceOptions([]); setError(null); }} className="text-[12px] font-bold bg-white hover:bg-slate-50 px-2 py-0.5 rounded-md text-indigo-600 border border-slate-200 shadow-sm transition-all active:scale-95">
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono">终点人物</label>
                          <div className="relative group">
                            <input 
                              type="text"
                              value={target}
                              onChange={(e) => setTarget(e.target.value)}
                              onFocus={() => setIsTargetFocused(true)}
                              onBlur={() => setTimeout(() => setIsTargetFocused(false), 200)}
                              placeholder="成吉思汗"
                              disabled={isLoading}
                              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[12px] focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 focus:bg-white outline-none transition-all font-bold placeholder:text-slate-300 shadow-sm disabled:opacity-50"
                            />
                            <User className="absolute left-3 top-2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />

                            {/* Autocomplete Dropdown */}
                            <AnimatePresence>
                              {isTargetFocused && filteredTargetNames.length > 0 && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  className="absolute top-full left-0 z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden py-1"
                                >
                                  {filteredTargetNames.map(name => (
                                    <button
                                      key={name}
                                      onClick={() => { setTarget(name); setIsTargetFocused(false); }}
                                      className="w-full text-left px-3 py-1.5 text-[12px] font-medium hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                                    >
                                      {name}
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                    )}

                    {!allowAdminControls && (
                      <div className="pt-2 flex gap-2 w-full">
                        <button 
                          onClick={handlePickRandomPair}
                          disabled={isPickingRandom || isLoading || !hasInitialCheckDone}
                          className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 disabled:opacity-50 rounded-xl font-bold text-[12px] transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
                        >
                          {(!hasInitialCheckDone) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className={`w-3.5 h-3.5 ${isPickingRandom ? 'animate-spin' : ''}`} />}
                          <span>{(!hasInitialCheckDone) ? "检查状态..." : "随机更换"}</span>
                        </button>
                        <button 
                          onClick={() => handleSearch()}
                          disabled={isPickingRandom || isSubmitting || !source.trim() || !target.trim() || !hasInitialCheckDone}
                          className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[12px] font-bold rounded-xl transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-1.5 active:scale-[0.98] group"
                        >
                          {isSubmitting || !hasInitialCheckDone ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 group-hover:animate-pulse" />}
                          <span>{isSubmitting ? "正在入队..." : (isLoading ? "正在解析..." : !hasInitialCheckDone ? "检查状态..." : "开启探索")}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
  
              {/* Stat Section */}
              {isAdmin && adminStats && (
                <div className="grid grid-cols-2 gap-2 mt-4 text-[11px] font-mono">
                    <div className="bg-slate-100 p-2 rounded-lg">
                        <div className="text-slate-500">目标库规模 (目标总数 / 已入库)</div>
                        <div className="font-bold text-slate-800">{adminStats.totalPool} / {adminStats.archivedPool}</div>
                    </div>
                    <div className="bg-slate-100 p-2 rounded-lg">
                        <div className="text-slate-500">时空连线人数 (被连接总计 / 已入库)</div>
                        <div className="font-bold text-slate-800">{adminStats.connectedTotal} / {adminStats.connectedArchived}</div>
                    </div>
                    <div className="bg-slate-100 p-2 rounded-lg col-span-2 flex items-center justify-between">
                        <div>
                            <div className="text-slate-500">时空锁死黑名单 (5次入库失败以上)</div>
                            <div className="font-bold text-red-600">{adminStats.blacklistCount}</div>
                        </div>
                        <button
                          onClick={handleDownloadBlacklist}
                          disabled={isDownloadingBlacklist || !adminStats.blacklistCount}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white h-[28px] px-3 text-[11px] font-bold rounded-lg transition-all shadow-md shadow-indigo-100 flex items-center justify-center gap-1 active:scale-[0.98] group"
                        >
                          {isDownloadingBlacklist ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Download className="w-3 h-3 group-hover:translate-y-0.5 transition-transform" />
                          )}
                          <span>下载名单</span>
                        </button>
                    </div>
                </div>
              )}

              {(isLoading || (allowAdminControls && searchSteps.length > 0) || queue.length > 0) && (
                <div className="flex flex-col animate-in fade-in duration-500">
                  <div className="flex flex-col space-y-3 font-mono relative mt-2">
                    {isLoading && !isAdmin && (
                      <div className="flex flex-col gap-3 mt-1 pl-4">
                         <div className="flex items-center gap-2 text-indigo-500 text-[12px] font-bold">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span className="animate-pulse">{subStatus === 'queued' ? `等待远端 Worker 承接任务 [${queue[0] || targetName || '...'}]` : `正在解析时空节点 [${targetName || '...'}]`}</span>
                         </div>
                      </div>
                    )}

                    {queue.length > 0 && (
                      <div className="mt-4 space-y-1.5 pt-3">
                        <div className="text-[12px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                          <Layers size={10} />
                          集群流水线任务队列 ({queue.length})
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {queue.map((name, idx) => (
                            <div 
                              key={name + idx} 
                              className={`group flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[12px] font-bold border shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-300 ${name === targetName ? 'bg-indigo-50 text-indigo-600 border-indigo-200 ring-2 ring-indigo-500/20' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
                              style={{ animationDelay: `${idx * 10}ms` }}
                            >
                              <span className="truncate max-w-[80px]">{name}</span>
                              {isAdmin ? (
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDequeue(name);
                                  }}
                                  className={`ml-0.5 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity p-0.5`}
                                  title="将此人从待入库队列中移除"
                                >
                                  <X size={10} strokeWidth={3} />
                                </button>
                              ) : (
                                name === targetName && <span className="text-[8px] animate-pulse">●</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
  

  
              {showResults && path && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col space-y-4"
                >
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-400">检索发现</h3>
                    <button 
                      onClick={clearResults}
                      className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                      title="重置"
                    >
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                  
                  {/* Path Summary Header - Only show if there's an actual path connecting different people */}
                  {path.length > 1 && (
                    <div className="p-4 bg-gradient-to-br from-indigo-50 to-white/50 border border-indigo-100/50 rounded-2xl shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                         <Zap className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="text-[12px] font-black text-slate-800 uppercase tracking-widest">时空关系探索报告</span>
                      </div>
                      <p className="text-[12px] text-slate-600 leading-relaxed font-bold">
                        成功建立 <span className="text-indigo-600">{path[0].name}</span> 
                        与 <span className="text-indigo-600">{path[path.length-1].name}</span> 之间的历史连接。
                        链条共包含 <span className="text-indigo-600">{path.length}</span> 个节点，
                        跨越了深厚的历史脉络。
                      </p>
                    </div>
                  )}
  
                  {/* Stylized Results List */}
                  <div className="relative pt-2">
                    <div className="absolute top-[20px] bottom-[20px] left-[26px] w-[2px] bg-slate-100 z-0"></div>
                    {path.map((item, idx) => (
                      <div key={idx} className="relative z-10">
                        {idx > 0 && (
                          <div className="py-3 pl-12 pr-2">
                            <div className="bg-indigo-50/60 p-2.5 rounded-md border border-indigo-100/30 text-[12px] font-bold text-indigo-500 text-center leading-tight shadow-sm">
                              {item.type || "时空关联"}
                            </div>
                          </div>
                        )}
                        <motion.div 
                          whileHover={{ x: 3 }}
                          onClick={() => onSelectPerson(-1, item.name)}
                          className="flex items-center gap-2.5 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 transition-all group cursor-pointer"
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border border-slate-100 ${newArrivals.includes(item.name) ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-indigo-600'}`}>
                             <User className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                             <div className="flex items-center justify-between gap-2 overflow-hidden">
                               <span className="text-[13px] font-black text-slate-800 break-words">{item.name}</span>
                               {newArrivals.includes(item.name) && (
                                 <span className="text-[11px] font-black bg-emerald-500 text-white px-1.5 py-0.5 rounded shadow-sm shrink-0">新入库</span>
                               )}
                             </div>
                          </div>
                        </motion.div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* Right Column: Interaction Process Logs (Worker Only) */}
          {showLogs && (
            <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
               <div className="px-5 py-4 bg-indigo-50/30 border-b border-indigo-100/30 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                       <Zap className={`w-3.5 h-3.5 ${isLoading ? 'text-indigo-500 animate-pulse' : 'text-indigo-600'} shrink-0`} />
                      <span className="text-[12px] font-black text-indigo-700 uppercase tracking-[0.2em] font-mono">集群运行日志 / Worker Trace</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const content = detailedLogs
                          .map(log => `[${log.timestamp}] [${((log as any).source || 'worker').toUpperCase()}] [${log.type.toUpperCase()}] ${log.msg}${log.data ? '\n' + JSON.stringify(log.data, null, 2) : ''}`)
                          .join('\n' + '-'.repeat(30) + '\n');
                        navigator.clipboard.writeText(content);
                      }}
                      className="text-[12px] font-black text-slate-500 hover:text-indigo-600 px-2 py-1 rounded-lg transition-all flex items-center gap-1.5 uppercase tracking-wider border border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/30"
                    >
                      <Save className="w-2.5 h-2.5" />
                      复制记录
                    </button>
                  </div>
               </div>
               
               <div ref={logsScrollRef} onScroll={handleLogsScroll} className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar font-mono text-[12px] space-y-3 select-text bg-[#fafbfc]">
                  {detailedLogs.length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-300 italic flex-col gap-2 py-20">
                      <Loader2 className="w-6 h-6 animate-spin opacity-20" />
                      <span className="text-[12px] uppercase tracking-widest font-black">等待集群数据包上行...</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {detailedLogs.map((log, i) => (
                      <div key={i} className="animate-in fade-in slide-in-from-left-1 duration-200">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-baseline gap-2.5">
                            <span className="font-bold text-slate-400 tabular-nums shrink-0 whitespace-nowrap">[{log.timestamp}]</span>
                            
                            <span className={`font-black uppercase tracking-tighter text-[11px] px-1 py-0.5 rounded-sm shrink-0 border ${
                              (log as any).source === 'worker' ? 'bg-indigo-50 border-indigo-100 text-indigo-500' : 'bg-slate-100 border-slate-200 text-slate-500'
                            }`}>
                              {(log as any).source || 'worker'}
                            </span>

                            <span className={`font-black uppercase tracking-tighter text-[11px] px-1 py-0 rounded shrink-0 flex items-center gap-1 ${
                              log.type === 'error' ? 'text-red-500' :
                              log.type === 'ai-req' || log.type === 'ai-res' ? 'text-amber-500' :
                              log.type === 'api' || log.type === 'success' ? 'text-emerald-500' : 
                              log.type === 'heartbeat' ? 'text-indigo-500' :
                              'text-slate-400'
                            }`}>
                              {log.type === 'heartbeat' && <span className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse"></span>}
                              {log.type === 'api' ? 'SERVER-OPS' : (log.type || "").replace('-', ' ')}
                            </span>
                          </div>
                          <div className="pl-0 flex-1 min-w-0">
                            <span className={`font-bold group selection:bg-indigo-100 leading-relaxed ${log.type === 'error' ? 'text-red-600' : 'text-slate-700'}`}>{log.msg || ""}</span>
                            {log.data && (
                              <div className="mt-1 text-slate-400 font-medium break-all leading-relaxed opacity-80 pl-2 border-l-2 border-indigo-100 text-[12px] bg-white/50 p-2 rounded-sm overflow-x-auto custom-scrollbar">
                                <pre className="whitespace-pre-wrap font-mono">
                                  {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
               </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (isInline) {
    const isShowingData = isLoading || showResults || error || (allowAdminControls && searchSteps.length > 0);
    const finalWidth = isPane 
      ? 'w-full' 
      : isShowingData && showLogs 
        ? 'w-full md:w-[680px] lg:w-[680px] xl:w-[740px]' 
        : isShowingData 
          ? 'w-full sm:w-[440px] md:w-[280px] lg:w-[280px]' 
          : 'w-full md:w-[280px]';

    return (
      <div className={`flex flex-col min-h-0 overflow-hidden h-full max-w-full transition-all duration-300 ${isCollapsed ? 'w-auto' : finalWidth}`}>
        {!hideHeader && (
          <div className="px-3 py-2 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors relative h-9 group" onClick={() => setIsCollapsed(!isCollapsed)}>
            {/* Collapsed mini progress bar */}
            {isCollapsed && isLoading && (
              <motion.div 
                className="absolute bottom-0 left-0 h-[2px] bg-indigo-500 opacity-60"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              />
            )}
            
            <div className="flex items-center gap-1.5 pr-2">
              <div className="relative">
                <Zap className={`w-3.5 h-3.5 ${isLoading ? 'text-indigo-500' : 'text-indigo-600'} shrink-0`} />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-800 whitespace-nowrap">{isAdmin ? "时空入库任务队列" : "时空关系网络探索"}</span>
                {isCollapsed && isLoading && (
                   <span className="text-[11px] font-bold text-indigo-500 -mt-1 uppercase tracking-tighter opacity-70">
                     {subStatus === 'queued' ? "队列等待中..." : "时空解析中..."}
                   </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isCollapsed && isLoading && (
                 <Loader2 className="w-3 h-3 text-indigo-400 animate-spin" />
              )}
              <button 
                className="p-1 hover:bg-white rounded-md text-slate-400 group-hover:text-indigo-600 transition-all border border-transparent hover:border-slate-200"
              >
                {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        )}
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/40">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-900/20 w-full max-w-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-indigo-50/50 to-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
               <Search className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">{isAdmin ? "时空入库排队系统" : "时空关系网络探索"}</h2>
              <p className="text-xs text-slate-500 font-medium tracking-wide">{isAdmin ? "管理集群归档任务与人物入库队列" : "寻找任意两个人物之间的跨时空联系"}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {content}

        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[12px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
            基于历史大数据与 AI 逻辑推理 <br/> 
            <span className="opacity-60">连接万物，洞见未来</span>
          </p>
        </div>
      </motion.div>
    </div>
  );
});
