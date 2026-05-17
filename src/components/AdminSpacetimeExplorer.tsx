import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { X, Search, ChevronRight, User, Loader2, Sparkles, AlertCircle, Zap, ChevronDown, ChevronUp, StopCircle, RefreshCw, Save, CheckCircle } from "lucide-react";
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
        <span className="opacity-70 ml-1 font-mono text-indigo-400">({seconds}s)</span>
      </span>
      <span className="mt-1 text-[10px] opacity-60 font-normal italic animate-pulse text-indigo-500/70">
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
                       setDetailedLogs([]);
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
                   if (allowAdminControls) {
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
                           
                           // Automatically pick next candidate after success
                           if (allowAdminControls || isAdmin) {
                               setTimeout(() => {
                                   handlePickRandomPair();
                               }, 500); 
                           }
                       } else {
                           pollStatusRef.current = false;
                       }
                   } else {
                       setIsLoading(false);
                       pollStatusRef.current = false;
                   }
               }

               if (data.logs && (pollStatusRef.current || isAdmin || hasLoadedResultRef.current)) setDetailedLogs(data.logs.slice(-50));
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
    if (logsScrollRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [detailedLogs]);
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

  const [isPickingRandom, setIsPickingRandom] = useState(false);

  const handlePickRandomPair = async () => {
    if (isLoading || pollStatusRef.current || isPickingRandom) return;
    setIsPickingRandom(true);
    setError(null);
    setPath(null);
    setDetailedLogs([]);
    setSearchSteps([]);
    setShowResults(false);
    
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
          setSource("");
          setTarget("");
          setError(
            <div className="flex flex-col gap-1 items-center">
              <p className="font-bold">✨ 所有预置及关联人物均已录入</p>
              <p className="text-[10px] opacity-70">系统已穷尽所有已知线索。请手动填入新的人物开启探索之旅。</p>
            </div>
          );
        } else {
          setSource(data.targetName || "");
          setTarget("");
        }
      } else {
        const res = await fetch("/api/archiver/random-pair");
        const data = await res.json() as any;
        if (data.sourceName && data.targetName) {
          setSource(data.sourceName);
          setTarget(data.targetName);
        }
      }
    } catch (e) {
      console.error(e);
      setError("检索随机人物失败，请稍后重试。");
    } finally {
      setIsPickingRandom(false);
    }
  };

  const handleSearch = async (overrideSource?: string, overrideTarget?: string) => {
    const finalSource = overrideSource || source;
    
    if (isAdmin) {
      if (isSubmitting) return;
      setIsCollapsed(false);
      setIsLoading(true);
      setIsSubmitting(true);
      setError(null);
      setPath(null);
      setShowResults(false);
      setSearchSteps([{ msg: "正在启动时空入库协议...", status: "pending", startTime: Date.now() }]);
      setDetailedLogs([]);
      
      const startTaskId = Date.now();
      activeSearchTaskIdRef.current = startTaskId;
      
      try {
        const headers: any = { "Content-Type": "application/json" };
        if (isAdmin) headers["x-admin-password"] = localStorage.getItem("admin_password") || "";
        
        const finalTargetForAI = overrideTarget || target || overrideSource || source;

        const res = await fetch("/api/explore/enqueue", {
          method: "POST",
          headers,
          body: JSON.stringify({ targetName: finalTargetForAI, isAdmin: true, clientTaskId: startTaskId, source: 'explorer' })
        });
        
        setIsSubmitting(false);

        if (!res.ok) {
           let errMsg = "探索启动失败";
           try {
             const errData = await res.json() as any;
             errMsg = errData.error || errMsg;
           } catch(e) {}
           throw new Error(errMsg);
        }
        
        pollStatusRef.current = true;
        // Auto-pick next candidate immediately after successful enqueue
        handlePickRandomPair();
      } catch (err: any) {
        setError(err.message || "探索过程中发生未知错误。");
        setIsLoading(false);
        setIsSubmitting(false);
      }
      return;
    }

    const finalTarget = overrideTarget || target;
    
    console.log("handleSearch executing with:", finalSource, finalTarget);

    if (!finalSource.trim() || !finalTarget.trim()) {
       console.log("handleSearch aborted: empty source or target");
       return;
    }
    
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
    setDetailedLogs([]);
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
                className="mt-2 text-[11px] font-bold py-1.5 px-3 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors w-fit border border-indigo-200"
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
        handlePickRandomPair();
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
    setDetailedLogs([]);
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
                              placeholder={isLoading ? (subStatus === 'queued' ? "任务正在队列排队..." : "时空节点解析中...") : "输入人名如：朱元璋"}
                              disabled={isPickingRandom}
                              className={`w-full pl-8 pr-10 py-2 border rounded-xl text-[12px] focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 outline-none transition-all font-bold placeholder:text-slate-300 shadow-sm ${isPickingRandom ? 'bg-indigo-50/50 border-indigo-200 text-indigo-700' : 'bg-slate-50 border-slate-200'}`}
                              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            {isLoading ? (
                              <Loader2 className="absolute left-3 top-2.5 w-3.5 h-3.5 text-indigo-500 animate-spin" />
                            ) : (
                              <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                            )}
                            <button 
                              onClick={handlePickRandomPair}
                              disabled={isPickingRandom || isLoading || !hasInitialCheckDone}
                              className="absolute right-2 top-2 text-slate-400 hover:text-indigo-600 transition-colors bg-white/50 p-1 rounded-md hover:bg-white shadow-sm border border-slate-100"
                              title="随机人物"
                            >
                              <RefreshCw size={12} className={isPickingRandom ? 'animate-spin' : ''} />
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
                          <button 
                            onClick={() => handleSearch()}
                            disabled={isPickingRandom || isSubmitting || !source.trim() || !hasInitialCheckDone || queue.length >= 20}
                            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white h-[38px] px-4 text-[12px] font-black rounded-xl transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-1.5 active:scale-[0.98] group whitespace-nowrap"
                          >
                            {isSubmitting || !hasInitialCheckDone || isPickingRandom ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 group-hover:animate-pulse" />}
                            <span>{queue.length >= 20 ? "队列已满" : (isSubmitting ? "正在入队..." : (isLoading ? "继续加入" : "开启探索"))}</span>
                          </button>
                        </div>
                      </div>
                    ) : (

                      <div className="flex flex-col sm:grid sm:grid-cols-2 md:flex md:flex-col gap-3">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono">起点人物</label>
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
                              <span className="text-[10px] text-slate-500 w-full mb-0.5">您是指：</span>
                              {sourceOptions.map(opt => (
                                <button key={opt} onClick={() => { setSource(opt); setSourceOptions([]); setError(null); }} className="text-[11px] font-bold bg-white hover:bg-slate-50 px-2 py-0.5 rounded-md text-indigo-600 border border-slate-200 shadow-sm transition-all active:scale-95">
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono">终点人物</label>
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
  
              {(isLoading || (allowAdminControls && searchSteps.length > 0 && !error)) && (
                <div className="flex flex-col animate-in fade-in duration-500">
                  <div className="flex flex-col space-y-3 font-mono border border-slate-100 bg-slate-50 rounded-xl p-4 relative shadow-sm">
                    {isLoading && (
                      <button 
                        onClick={handleStop}
                        className="absolute right-3 top-3 z-10 text-slate-400 hover:text-red-500 hover:bg-slate-200/50 p-1 rounded-md transition-all active:scale-90"
                        title="停止执行"
                      >
                         <StopCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {searchSteps.map((step, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-start gap-2.5 group"
                      >
                        <div className="mt-1 shrink-0">
                          {step.status === 'success' ? (
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 border border-emerald-200" />
                          ) : step.status === 'error' ? (
                            <div className="w-1.5 h-1.5 rounded-full bg-red-500 border border-red-200" />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 border border-indigo-200 animate-pulse" />
                          )}
                        </div>
                        <span className={`text-[11px] font-medium leading-relaxed selection:bg-indigo-100 ${
                          step.status === 'success' ? 'text-slate-500' : 
                          step.status === 'error' ? 'text-red-500' : 'text-slate-800'
                        }`}>
                          {step.msg}
                        </span>
                        {step.startTime && (
                          <span className="text-[9px] text-slate-300 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                            {new Date(step.startTime).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </motion.div>
                    ))}
                    {isLoading && (
                       <div className="flex flex-col gap-3 mt-1 pl-4">
                          <div className="flex items-center gap-2 text-indigo-500 text-[11px] font-bold">
                             <Loader2 className="w-3.5 h-3.5 animate-spin" />
                             <span className="animate-pulse">{subStatus === 'queued' ? `等待远端 Worker 承接任务 [${targetName || '...'}]` : "时空协议深度分析中..."}</span>
                          </div>
                          
                          {queue.length > 0 && (
                            <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-3">
                              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                                <RefreshCw size={10} className="animate-spin" />
                                集群流水线人物列表 ({queue.length})
                              </div>
                              <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1 custom-scrollbar">
                                {queue.map((name, idx) => (
                                  <div 
                                    key={name + idx} 
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shadow-sm animate-in fade-in slide-in-from-bottom-1 duration-300 ${name === targetName ? 'bg-indigo-50 text-indigo-600 border-indigo-200 ring-2 ring-indigo-500/20' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
                                    style={{ animationDelay: `${idx * 10}ms` }}
                                  >
                                    {name}
                                    {name === targetName && <span className="ml-1 text-[8px] animate-pulse">●</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Local Activity Logs */}
                          {detailedLogs.filter(log => (log as any).source !== 'worker').length > 0 && (
                            <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                               <div className="text-[10px] text-slate-400 font-black uppercase tracking-wider">本地排队状态日志</div>
                               <div className="space-y-1.5">
                                 {detailedLogs.filter(log => (log as any).source !== 'worker').slice(-10).map((log, i) => (
                                   <div key={i} className="flex items-baseline gap-2 text-[10px]">
                                     <span className="text-slate-300 font-mono tabular-nums shrink-0">[{log.timestamp}]</span>
                                     <span className={`px-1 rounded-[2px] font-black uppercase tracking-tighter text-[7px] ${
                                       log.type === 'error' ? 'bg-red-50 text-red-500' : 
                                       log.type === 'success' ? 'bg-emerald-50 text-emerald-500' : 
                                       'bg-slate-100 text-slate-400'
                                     }`}>{log.type}</span>
                                     <span className={`font-bold truncate ${log.type === 'error' ? 'text-red-600' : 'text-slate-600'}`}>{log.msg}</span>
                                   </div>
                                 ))}
                               </div>
                            </div>
                          )}
                       </div>
                    )}
                  </div>
                </div>
              )}
  
              {error && (
                <div className="flex flex-col items-center justify-center py-6 text-center animate-in fade-in zoom-in duration-300">
                  <div className={`w-12 h-12 ${(typeof error === 'string' && error.includes("中止")) ? "bg-slate-100 text-slate-400" : "bg-red-50 text-red-500"} rounded-2xl flex items-center justify-center mb-3 shadow-sm`}>
                      {(typeof error === 'string' && error.includes("中止")) ? <Search className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
                  </div>
                  <h4 className="text-slate-800 font-bold text-sm mb-1">{(typeof error === 'string' && error.includes("中止")) ? "会话已终止" : "检索异常"}</h4>
                  <div className="text-[10px] text-slate-400 px-4 leading-relaxed mb-4 whitespace-pre-wrap">{error}</div>
                  <button 
                    onClick={clearResults}
                    className="px-4 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-50 transition-colors"
                  >
                    重置
                  </button>
                </div>
              )}
  
              {showResults && path && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col space-y-4"
                >
                  <div className="flex items-center justify-between px-1">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">检索发现</h3>
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
                        <span className="text-[9px] font-black text-slate-800 uppercase tracking-widest">时空关系探索报告</span>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed font-bold">
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
                            <div className="bg-indigo-50/60 p-2.5 rounded-md border border-indigo-100/30 text-[10px] font-bold text-indigo-500 text-center leading-tight shadow-sm">
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
                                 <span className="text-[8px] font-black bg-emerald-500 text-white px-1.5 py-0.5 rounded shadow-sm shrink-0">新入库</span>
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

          {/* Right Column (on Desktop) / Bottom Column (on Mobile): Interaction Process Logs (Worker Only) */}
          {showLogs && (isLoading || showResults || error || (allowAdminControls && searchSteps.length > 0)) && (
            <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
               <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                       <Zap className={`w-3.5 h-3.5 ${isLoading ? 'text-indigo-500' : 'text-indigo-600'} shrink-0`} />
                      <span className="text-[10px] font-black text-slate-700 uppercase tracking-[0.2em] font-mono">集群运行日志 (Worker)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const content = detailedLogs
                          .filter(log => (log as any).source === 'worker')
                          .map(log => `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.msg}${log.data ? '\n' + JSON.stringify(log.data, null, 2) : ''}`)
                          .join('\n' + '-'.repeat(30) + '\n');
                        navigator.clipboard.writeText(content);
                      }}
                      className="text-[9px] font-black text-slate-500 hover:text-indigo-600 px-2 py-1 rounded-lg transition-all flex items-center gap-1.5 uppercase tracking-wider border border-slate-100 hover:border-indigo-100 hover:bg-indigo-50/30"
                    >
                      <Save className="w-2.5 h-2.5" />
                      复制日志
                    </button>
                  </div>
               </div>
               
               <div ref={logsScrollRef} className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar font-mono text-[11px] space-y-3 select-text bg-white">
                  {detailedLogs.filter(log => (log as any).source === 'worker').length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-300 italic flex-col gap-2 py-20">
                      <Loader2 className="w-6 h-6 animate-spin opacity-20" />
                      <span>等待集群追踪数据包中...</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {detailedLogs.filter(log => (log as any).source === 'worker').map((log, i) => (
                      <div key={i} className="animate-in fade-in slide-in-from-left-1 duration-200">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-baseline gap-2.5">
                            <span className="font-bold text-slate-300 tabular-nums shrink-0 whitespace-nowrap">[{log.timestamp}]</span>
                            <span className={`font-black uppercase tracking-tighter text-[8px] px-1 py-0 rounded shrink-0 flex items-center gap-1 ${
                              log.type === 'error' ? 'text-red-500' :
                              log.type === 'ai-req' || log.type === 'ai-res' ? 'text-amber-500' :
                              log.type === 'api' || log.type === 'success' ? 'text-emerald-500' : 
                              log.type === 'heartbeat' ? 'text-emerald-500' :
                              'text-slate-400'
                            }`}>
                              {log.type === 'heartbeat' && <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse"></span>}
                              {log.type === 'api' ? 'SERVER' : (log.type || "").replace('-', ' ')}
                            </span>
                          </div>
                          <div className="pl-0 flex-1 min-w-0">
                            <span className={`font-bold ${log.type === 'error' ? 'text-red-600' : 'text-slate-700'}`}>{log.msg || ""}</span>
                            {log.data && (
                              <div className="mt-1 text-slate-400 font-medium break-all leading-relaxed opacity-80 pl-2 border-l border-slate-100 text-[10px]">
                                {typeof log.data === 'string' ? log.data : JSON.stringify(log.data, null, 2)}
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
                <span className="text-xs font-bold text-slate-800 whitespace-nowrap">时空关系网络探索</span>
                {isCollapsed && isLoading && (
                   <span className="text-[8px] font-bold text-indigo-500 -mt-1 uppercase tracking-tighter opacity-70">
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
              <h2 className="text-xl font-bold text-slate-800">时空关系网络探索</h2>
              <p className="text-xs text-slate-500 font-medium tracking-wide">寻找任意两个人物之间的跨时空联系</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-6 h-6 text-slate-400" />
          </button>
        </div>

        {content}

        <div className="p-6 bg-slate-50 border-t border-slate-100 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
            基于历史大数据与 AI 逻辑推理 <br/> 
            <span className="opacity-60">连接万物，洞见未来</span>
          </p>
        </div>
      </motion.div>
    </div>
  );
});
