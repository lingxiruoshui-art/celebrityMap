import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { X, Search, ChevronRight, User, Loader2, Sparkles, AlertCircle, Zap, ChevronDown, ChevronUp, StopCircle, RefreshCw, Save } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGemini, ARCHIVE_PROMPT, ARCHIVE_SCHEMA, PATH_PROMPT, PATH_SCHEMA, VALIDATION_PROMPT, VALIDATION_SCHEMA } from "../services/geminiService";

export interface SpacetimeExplorerHandle {
  start: (overrideSource?: string, overrideTarget?: string) => void;
  clear: () => void;
}

interface SpacetimeExplorerProps {
  onClose: () => void;
  onRefreshArchive: () => void;
  onSelectPerson: (id: number) => void;
  onPathFound?: (path: Step[] | null) => void;
  isInline?: boolean;
  initialSource?: string;
  initialTarget?: string;
  autoStart?: boolean;
  hideInputs?: boolean;
  hideHeader?: boolean;
  remainingQuota?: number | null;
  onQuotaUpdate?: (quota: number) => void;
  isAdmin?: boolean;
  showLogs?: boolean;
}

interface Step {
  name: string;
  type?: string;
}

export default forwardRef<SpacetimeExplorerHandle, SpacetimeExplorerProps>(function SpacetimeExplorer({ 
  onClose, 
  onRefreshArchive, 
  onSelectPerson, 
  onPathFound, 
  isInline,
  initialSource = "",
  initialTarget = "",
  autoStart = false,
  hideInputs = false,
  hideHeader = false,
  remainingQuota,
  onQuotaUpdate,
  isAdmin = false,
  showLogs = false
}, ref) {
  const [source, setSource] = useState(() => initialSource || localStorage.getItem("last_explorer_source") || "");
  const [target, setTarget] = useState(() => initialTarget || localStorage.getItem("last_explorer_target") || "");

  useImperativeHandle(ref, () => ({
    start: (overrideSource?: string, overrideTarget?: string) => {
      console.log("SpacetimeExplorer start called with:", source, target, "overrides:", overrideSource, overrideTarget);
      setIsCollapsed(false);
      handleSearch(overrideSource, overrideTarget);
    },
    clear: () => {
      clearResults();
      if (hideHeader) setIsCollapsed(true);
    }
  }));

  useEffect(() => {
    if (initialSource) setSource(initialSource);
  }, [initialSource]);

  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
  }, [initialTarget]);

  useEffect(() => {
    localStorage.setItem("last_explorer_source", source);
  }, [source]);

  useEffect(() => {
    localStorage.setItem("last_explorer_target", target);
  }, [target]);
  const [isLoading, setIsLoading] = useState(false);
  const [path, setPath] = useState<Step[] | null>(null);
  const [newArrivals, setNewArrivals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(() => hideHeader ? false : true);
  const [detailedLogs, setDetailedLogs] = useState<{timestamp: string, msg: string, data?: any, type: 'info' | 'ai-req' | 'ai-res' | 'error'}[]>([]);
  const [searchSteps, setSearchSteps] = useState<{msg: string, status: 'pending' | 'success' | 'error'}[]>([]);
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
  const abortControllerRef = useRef<AbortController | null>(null);

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

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    if (!path) {
      setError("搜索已由用户中断。");
    }
  };

  const [isPickingRandom, setIsPickingRandom] = useState(false);

  const handlePickRandomPair = async () => {
    setIsPickingRandom(true);
    try {
      if (isAdmin) {
        const res = await fetch("/api/archiver/admin-pick-pair", { method: "POST" });
        const data = await res.json();
        
        if (data.needsAI) {
           const genRes = await fetch("/api/archiver/generate-target", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sourceName: data.sourceName })
           });
           const genData = await genRes.json();
           if (data.sourceName) setSource(data.sourceName);
           if (genData.targetName) setTarget(genData.targetName);
        } else {
           if (data.sourceName) setSource(data.sourceName);
           if (data.targetName) setTarget(data.targetName);
        }
      } else {
        const res = await fetch("/api/archiver/random-pair");
        const data = await res.json();
        if (data.sourceName && data.targetName) {
          setSource(data.sourceName);
          setTarget(data.targetName);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsPickingRandom(false);
    }
  };

  const handleSearch = async (overrideSource?: string, overrideTarget?: string) => {
    const finalSource = overrideSource || source;
    const finalTarget = overrideTarget || target;
    
    console.log("handleSearch executing with:", finalSource, finalTarget);

    if (!finalSource.trim() || !finalTarget.trim()) {
       console.log("handleSearch aborted: empty source or target");
       return;
    }

    if (!isAdmin && remainingQuota !== null && remainingQuota !== undefined && remainingQuota <= 0) {
      setError("今日探索次数已达上限，请明天再试或联系管理员。");
      return;
    }
    
    setIsCollapsed(false);
    setIsLoading(true);
    setError(null);
    setPath(null);
    setShowResults(false);
    if (onPathFound) onPathFound(null);
    setNewArrivals([]);
    setSearchSteps([]);
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const addLog = (msg: string, type: 'ui' | 'api' | 'ai-req' | 'ai-res' | 'error' = 'ui', data?: any) => {
      const log = { timestamp: new Date().toLocaleTimeString(), msg, data, type };
      setDetailedLogs(prev => [...prev, log]);
    };

    const addStep = (msg: string) => {
      setSearchSteps(prev => [...prev, { msg, status: 'pending' }]);
      // No duplicate addLog here, searchSteps are visible separately
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 50);
    };
    
    const updateLastStep = (status: 'success' | 'error' | 'pending', msg?: string) => {
      setSearchSteps(prev => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1];
        if (status === 'error') {
           addLog(`步骤失败: ${msg || last.msg}`, 'error');
        }
        return [...prev.slice(0, -1), { msg: msg || last.msg, status }];
      });
    };

    try {
      setDetailedLogs([]);
      addLog("启动时空探索协议会话", "api", { source: finalSource, target: finalTarget, timestamp: new Date().toISOString() });
      addStep("正在初始化跨时空检索协议...");
      
      addLog("请求馆藏核心元数据", "api", { endpoint: "/api/metadata" });
      const metaRes = await fetch("/api/metadata", { signal });
      const currentMeta = await metaRes.json();
      addLog("元数据同步成功", "api", currentMeta);
      setMetadata(currentMeta);
      
      const provider = currentMeta.activeProvider || "gemini";
      const modelId = provider === "gemini" ? currentMeta.geminiModelId : currentMeta.aliyunModelId;

      if (!modelId) {
        throw new Error(`请先在后台配置 ${provider === 'gemini' ? 'Gemini' : 'Aliyun'} 模型 ID`);
      }
      updateLastStep('success');

      addStep(`正在识别人物身份: ${finalSource} 与 ${finalTarget}...`);
      
      const callAIProxy = async (prompt: string, responseFormat: 'text' | 'json' = 'json', schema?: any) => {
        addLog(`AI 代理请求发送`, 'ai-req', { prompt, responseFormat, schema });
        const res = await fetch("/api/ai/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, responseFormat, schema }),
            signal
        });
        if (!res.ok) {
            const err = await res.json();
            addLog("AI 服务响应失败", 'error', err);
            throw new Error(err.error || "AI 服务异常");
        }
        const data = await res.json();
        addLog("AI 响应解码成功", 'ai-res', { rawText: data.text });
        return data.text;
      };
      const existingArray = currentMeta?.existingNames ? currentMeta.existingNames.split("、") : [];
      const findNormalizedInDB = (name: string) => {
        const trimmed = name.trim();
        return existingArray.find(ex => ex.toLowerCase() === trimmed.toLowerCase()) || null;
      };

      const validate = async (name: string) => {
        // Optimization: If name already in DB, skip AI validation
        const localMatch = findNormalizedInDB(name);
        if (localMatch) {
          return { accepted: true, normalizedName: localMatch, reason: "馆藏库内已存身份" };
        }
        
        const text = await callAIProxy(VALIDATION_PROMPT(name, currentMeta?.existingNames || ""), "json", VALIDATION_SCHEMA);
        let parsed: { accepted?: boolean; normalizedName?: string; reason?: string } = {};
        try {
          let rawParsed = JSON.parse(text || "{}");
          if (Array.isArray(rawParsed) && rawParsed.length > 0) {
            parsed = rawParsed[0];
          } else {
            parsed = rawParsed;
          }
        } catch (e) {
          console.error("Failed to parse validation JSON:", text);
          return { accepted: false, reason: "AI 响应解析失败" };
        }
        
        if (parsed.accepted === undefined) {
           console.error("Missing standard keys in AI response:", parsed);
           if ((parsed as any).result && (parsed as any).result.accepted !== undefined) {
              parsed = (parsed as any).result;
           } else {
              return { accepted: false, reason: "系统未能识别该人物，可能非历史人物" };
           }
        }
        
        return parsed;
      };

      const [srcValid, tgtValid] = await Promise.all([validate(finalSource), validate(finalTarget)]);
      
      if (!srcValid.accepted) throw new Error(`起点人物无效: ${srcValid.reason || '原因未知'}`);
      if (!tgtValid.accepted) throw new Error(`终点人物无效: ${tgtValid.reason || '原因未知'}`);
      
      const normalizedSource = srcValid.normalizedName || finalSource;
      const normalizedTarget = tgtValid.normalizedName || finalTarget;
      updateLastStep('success', `识别成功: ${normalizedSource} 与 ${normalizedTarget}`);

      addStep("正在扫描馆藏路径...");
      const pathRes = await fetch("/api/pathfind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceName: normalizedSource, targetName: normalizedTarget }),
        signal
      });
      const pathData = await pathRes.json();
      
      if (pathData.path) {
        updateLastStep('success', "在现有馆藏中找到直接路径！");
        setPath(pathData.path);
        setShowResults(true);
        if (onPathFound) onPathFound(pathData.path);
        setIsLoading(false);
        return;
      }
      updateLastStep('success', "现有馆藏中无直接路径，启动 AI 逻辑推理...");

      addStep("AI 正在编织历史脉络...");
      const bridgeText = await callAIProxy(PATH_PROMPT(normalizedSource, normalizedTarget, currentMeta?.existingNames || ""), "json", PATH_SCHEMA);
      let bridgeData: any = { chain: [] };
      try {
        let rawBridge = JSON.parse(bridgeText || "{}");
        if (Array.isArray(rawBridge) && rawBridge.length > 0) {
          bridgeData = rawBridge[0];
        } else {
          bridgeData = rawBridge;
        }
      } catch (e) {
        console.error("AI 响应解析失败:", bridgeText);
        throw new Error("AI 返回了无法解析的关系数据，请稍后重试。");
      }
      
      let chain = bridgeData.chain;
      if (!chain && bridgeData.result && bridgeData.result.chain) {
          chain = bridgeData.result.chain;
      }
      chain = chain || [];

      if (chain.length < 2) {
        console.warn("AI 未能产出有效路径:", bridgeData);
        throw new Error("AI 未能建立有效联系，请尝试更换人物或重新搜索。");
      }
      updateLastStep('success');

      const arrivals: string[] = [];
      const finalPath: Step[] = [];

      for (let i = 0; i < chain.length; i++) {
        if (signal.aborted) throw new Error("AbortError");
        const step = chain[i];
        if (!step.name) continue; // Skip malformed steps
        addStep(`正在处理节点: ${step.name}...`);
        
        // Check if exists and archive if not on server
        const checkRes = await fetch("/api/save-archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: step.name })
        });
        let checkData = await checkRes.json();

        if (checkData.isNew || !checkData.isFull) {
            updateLastStep('pending', `正在为新发现的人物 ${step.name} 撰写传记...`);
            const archiveText = await callAIProxy(ARCHIVE_PROMPT(step.name, metadata?.categories || [], metadata?.existingNames || ""), "json", ARCHIVE_SCHEMA);
            let personData: any = {};
            try {
              let rawPerson = JSON.parse(archiveText || "{}");
              if (Array.isArray(rawPerson) && rawPerson.length > 0) {
                personData = rawPerson[0];
              } else {
                personData = rawPerson;
              }
            } catch (e) {
              console.error("AI 撰写传记解析失败:", archiveText);
              throw new Error("AI 生成的人物传记无法解析，探索被中断。");
            }
            if (!personData.biography && personData.result && personData.result.biography) {
              personData = personData.result;
            }
            
            // Send back to server to update with full data
            await fetch("/api/save-archive", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: step.name, data: personData })
            });
            arrivals.push(step.name);
            onRefreshArchive();
        }

        // Save the edge between this person and the previous one IF it's not the first node
        if (i > 0) {
            await fetch("/api/save-relationship", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sourceName: chain[i-1].name,
                    targetName: step.name,
                    relationshipType: step.relationshipToPrevious
                })
            });
            // Update relationships globally
            onRefreshArchive();
        }

        const currentStep = { name: step.name, type: step.relationshipToPrevious };
        finalPath.push(currentStep);
        
        // Progressively update local path for UI feedback in sidebar
        setPath([...finalPath]);
        
        updateLastStep('success');
      }

      setPath(finalPath);
      setNewArrivals(arrivals);
      setShowResults(true);
      if (onPathFound) onPathFound(finalPath);
      
      // Update usage on server if not in DB originally (AI was involved)
      if (!pathData.path && !isAdmin) {
        try {
          const usageRes = await fetch("/api/usage/record", { method: "POST" });
          if (usageRes.ok) {
            const usageData = await usageRes.json();
            if (onQuotaUpdate) onQuotaUpdate(usageData.remaining);
          }
        } catch(e) {
          console.error("Failed to record usage", e);
        }
      }

      if (arrivals.length > 0) onRefreshArchive();

    } catch (err: any) {
      if (err.name === 'AbortError' || err.message === 'AbortError') {
        addStep("探索已按用户指令中止。");
        updateLastStep('error');
      } else {
        console.error(err);
        setError(err.message || "探索过程中发生未知错误。");
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  useEffect(() => {
     if (autoStart && initialSource && initialTarget) {
       handleSearch();
     }
  }, []); // Only on mount

  const clearResults = () => {
    setPath(null);
    setShowResults(false);
    if (onPathFound) onPathFound(null);
    setSearchSteps([]);
    setDetailedLogs([]);
    setError(null);
    setNewArrivals([]);
  };

  const content = (
    <div className={`flex flex-col h-full w-full overflow-hidden transition-all duration-300 ${!isCollapsed ? (isInline ? "p-0" : "p-6") : "p-0"}`}>
      {!isCollapsed && (
        <div className={`flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 bg-white ${showLogs ? "" : "items-center"}`}>
          {/* Main Controls & Results Column (Responsive Width - Now on Left) */}
          <div className={`${showLogs ? "w-full lg:w-[360px] xl:w-[420px] lg:border-r border-slate-100 bg-slate-50/20 shadow-[-10px_0_20px_-10px_rgba(0,0,0,0.05)_inset]" : "w-full max-w-[440px] mx-auto"} flex flex-col flex-1 lg:flex-none lg:shrink-0 overflow-hidden min-h-[40%] lg:min-h-0`}>
              <div className="flex-1 overflow-y-auto custom-scrollbar px-5 pb-5 sm:px-6 sm:pb-6 space-y-6">
                {!showResults && !error && !hideInputs && (
                  <div className="space-y-4 pt-2 pb-6 border-b border-slate-100 mb-2">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono">起点人物</label>
                      <div className="relative group">
                        <input 
                          type="text"
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                          placeholder="苏格拉底"
                          disabled={isLoading}
                          className="w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[13px] focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 focus:bg-white outline-none transition-all font-bold placeholder:text-slate-300 shadow-sm disabled:opacity-50"
                        />
                        <User className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono">终点人物 (拟收录)</label>
                      <div className="relative group">
                        <input 
                          type="text"
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                          placeholder="成吉思汗"
                          disabled={isLoading}
                          className="w-full pl-9 pr-3 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-[13px] focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500/50 focus:bg-white outline-none transition-all font-bold placeholder:text-slate-300 shadow-sm disabled:opacity-50"
                        />
                        <User className="absolute left-3.5 top-3.5 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                      </div>
                    </div>

                    <div className="pt-2 flex gap-2 w-full">
                      {isAdmin && (
                        <button 
                          onClick={handlePickRandomPair}
                          disabled={isPickingRandom || isLoading}
                          className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 disabled:opacity-50 rounded-xl font-bold text-[13px] transition-all flex items-center justify-center gap-1.5 active:scale-[0.98]"
                        >
                          <RefreshCw className={`w-4 h-4 ${isPickingRandom ? 'animate-spin' : ''}`} />
                          <span>随机更换</span>
                        </button>
                      )}
                      <button 
                        onClick={() => handleSearch()}
                        disabled={isLoading || !source.trim() || !target.trim()}
                        className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[13px] font-bold rounded-xl transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-1.5 active:scale-[0.98] group"
                      >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 group-hover:animate-pulse" />}
                        <span>{isLoading ? "正在编织..." : "开启探索"}</span>
                      </button>
                    </div>
                  </div>
                )}
  
              {isLoading && (
                <div className="flex flex-col animate-in fade-in duration-500">
                  <div className="flex items-center gap-3 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100 border-dashed mb-4 relative overflow-hidden shrink-0">
                      <motion.div 
                        className="absolute inset-0 bg-indigo-100/30"
                        animate={{ opacity: [0.2, 0.4, 0.2] }}
                        transition={{ duration: 2, repeat: Infinity }}
                      />
                      <Loader2 className="w-5 h-5 text-indigo-600 animate-spin relative z-10 shrink-0" />
                      <div className="flex-1 relative z-10 min-w-0">
                        <div className="text-[11px] font-black text-indigo-600 tracking-tight mb-1 truncate">AI 正在编织历史脉络...</div>
                        <div className="h-1.5 w-full bg-indigo-100/50 rounded-full overflow-hidden">
                          <motion.div 
                             className="h-full bg-indigo-500"
                             initial={{ width: "0%" }}
                             animate={{ width: "100%" }}
                             transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                          />
                        </div>
                      </div>
                      
                      <button 
                        onClick={handleStop}
                        className="relative z-10 w-9 h-9 rounded-xl bg-white shadow-sm border border-red-100 text-red-500 hover:bg-red-50 transition-all flex items-center justify-center shrink-0 active:scale-90"
                        title="停止探索"
                      >
                        <StopCircle className="w-5 h-5" />
                      </button>
                  </div>
                  <div className="flex flex-col space-y-2.5 pl-2 border-l-2 border-slate-100 mb-2">
                    {searchSteps.map((step, i) => (
                      <motion.div 
                        key={i}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-start gap-2 group"
                      >
                        <div className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${step.status === 'success' ? 'bg-emerald-500' : step.status === 'error' ? 'bg-red-500' : 'bg-indigo-500 animate-pulse'}`} />
                        <span className={`text-[10px] font-bold tracking-tight break-words leading-relaxed ${step.status === 'pending' ? 'text-indigo-600' : 'text-slate-400 font-medium'}`}>
                          {step.msg}
                          {step.status === 'success' && <span className="ml-1 opacity-50">✓</span>}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
  
              {error && (
                <div className="flex flex-col items-center justify-center py-6 text-center animate-in fade-in zoom-in duration-300">
                  <div className={`w-12 h-12 ${error.includes("中止") ? "bg-slate-100 text-slate-400" : "bg-red-50 text-red-500"} rounded-2xl flex items-center justify-center mb-3 shadow-sm`}>
                      {error.includes("中止") ? <Search className="w-6 h-6" /> : <AlertCircle className="w-6 h-6" />}
                  </div>
                  <h4 className="text-slate-800 font-bold text-sm mb-1">{error.includes("中止") ? "会话已终止" : "检索异常"}</h4>
                  <p className="text-[10px] text-slate-400 px-4 leading-relaxed mb-4">{error}</p>
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
                  
                  {/* Path Summary Header */}
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
  
                  {/* Stylized Results List */}
                  <div className="relative pt-2">
                    <div className="absolute top-[20px] bottom-[20px] left-[26px] w-[2px] bg-slate-100 z-0"></div>
                    
                    {path.map((item, idx) => (
                      <div key={idx} className="relative z-10">
                        {idx > 0 && (
                          <div className="py-3 pl-12 pr-2">
                            <div className="bg-indigo-50/60 p-2.5 rounded-xl border border-indigo-100/30 text-[10px] font-bold text-indigo-500 text-center leading-tight shadow-sm">
                              {item.type || "历史渊源"}
                            </div>
                          </div>
                        )}
                        
                        <motion.div 
                          whileHover={{ x: 3 }}
                          onClick={() => {
                            // Find person in storage or just select by name logic could go here
                            onSelectPerson(0); // Placeholder
                          }}
                          className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/10 transition-all group cursor-pointer"
                        >
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border border-slate-100 ${newArrivals.includes(item.name) ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-indigo-600'}`}>
                             <User className="w-5 h-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                             <div className="flex items-center justify-between gap-2 overflow-hidden">
                               <span className="text-[13px] font-black text-slate-800 break-words">{item.name}</span>
                               {newArrivals.includes(item.name) && (
                                 <span className="text-[8px] font-black bg-emerald-500 text-white px-1.5 py-0.5 rounded shadow-sm shrink-0">NEW</span>
                               )}
                             </div>
                             <div className="text-[10px] text-slate-400 font-medium whitespace-normal">历史跨度关联人物</div>
                          </div>
                        </motion.div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          {/* Right Column (on Desktop) / Bottom Column (on Mobile): Interaction Process Logs */}
          {showLogs && (isLoading || showResults || error) && (
            <div className="flex-1 flex flex-col min-w-0 bg-white overflow-hidden">
               <div className="px-5 py-4 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(79,70,229,0.4)]"></div>
                    <span className="text-[10px] font-black text-slate-700 uppercase tracking-[0.2em] font-mono">Trace Log</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        const content = detailedLogs
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
               
               <div ref={logsScrollRef} className="flex-1 overflow-y-auto p-5 custom-scrollbar font-mono text-[11px] space-y-3 select-text bg-white">
                  {detailedLogs.length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-300 italic flex-col gap-2 py-20">
                      <Loader2 className="w-6 h-6 animate-spin opacity-20" />
                      <span>等待追踪数据包中...</span>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {detailedLogs.map((log, i) => (
                      <div key={i} className="animate-in fade-in slide-in-from-left-1 duration-200">
                        <div className="flex items-baseline gap-2.5">
                          <span className="font-bold text-slate-300 tabular-nums shrink-0 whitespace-nowrap">[{log.timestamp}]</span>
                          <span className={`font-black uppercase tracking-tighter text-[8px] px-1 py-0 rounded shrink-0 ${
                            log.type === 'error' ? 'text-red-500' :
                            log.type === 'ai-req' || log.type === 'ai-res' ? 'text-amber-500' :
                            log.type === 'api' ? 'text-indigo-500' : 
                            'text-slate-400'
                          }`}>
                            {log.type === 'api' ? 'SERVER' : log.type.replace('-', ' ')}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className={`font-bold ${log.type === 'error' ? 'text-red-600' : 'text-slate-700'}`}>{log.msg}</span>
                            {log.data && (
                              <div className="mt-1 text-slate-400 font-medium break-all leading-relaxed opacity-80 pl-2 border-l border-slate-100">
                                {JSON.stringify(log.data)}
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
    const isShowingData = isLoading || showResults || error;
    const finalWidth = isShowingData && showLogs 
      ? 'w-full lg:w-[1000px] xl:w-[1100px]' 
      : isShowingData 
        ? 'w-full sm:w-[440px]' 
        : 'w-full sm:w-[380px]';

    return (
      <div className={`flex flex-col h-full max-w-full transition-all duration-300 ${isCollapsed ? 'w-auto' : finalWidth}`}>
        {!hideHeader && (
          <div className="px-3 py-2 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => setIsCollapsed(!isCollapsed)}>
            <div className="flex items-center gap-1.5 pr-2">
              <Zap className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="text-xs font-bold text-slate-800 whitespace-nowrap">时空关系网络探索</span>
            </div>
            <button 
              className="p-1 hover:bg-white rounded-md text-slate-400 hover:text-indigo-600 transition-all border border-transparent hover:border-slate-200"
            >
              {isCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
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
