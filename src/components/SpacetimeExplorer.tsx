import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { X, Search, ChevronRight, User, Loader2, Sparkles, AlertCircle, Zap, ChevronDown, ChevronUp, StopCircle, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { getGemini, ARCHIVE_PROMPT, ARCHIVE_SCHEMA, PATH_PROMPT, PATH_SCHEMA, VALIDATION_PROMPT, VALIDATION_SCHEMA } from "../services/geminiService";

export interface SpacetimeExplorerHandle {
  start: () => void;
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
  isAdmin = false
}, ref) {
  const [source, setSource] = useState(() => initialSource || localStorage.getItem("last_explorer_source") || "");
  const [target, setTarget] = useState(() => initialTarget || localStorage.getItem("last_explorer_target") || "");

  useImperativeHandle(ref, () => ({
    start: (overrideSource?: string, overrideTarget?: string) => {
      console.log("SpacetimeExplorer start called with:", source, target, "overrides:", overrideSource, overrideTarget);
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
    localStorage.setItem("last_explorer_source", source);
  }, [source]);

  useEffect(() => {
    localStorage.setItem("last_explorer_target", target);
  }, [target]);
  const [isLoading, setIsLoading] = useState(false);
  const [path, setPath] = useState<Step[] | null>(null);
  const [newArrivals, setNewArrivals] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
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
  const abortControllerRef = useRef<AbortController | null>(null);
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
      const res = await fetch("/api/archiver/random-pair");
      const data = await res.json();
      if (data.sourceName && data.targetName) {
        setSource(data.sourceName);
        setTarget(data.targetName);
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
    
    setIsLoading(true);
    setError(null);
    setPath(null);
    setShowResults(false);
    if (onPathFound) onPathFound(null);
    setNewArrivals([]);
    setSearchSteps([]);
    
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const addStep = (msg: string) => {
      setSearchSteps(prev => [...prev, { msg, status: 'pending' }]);
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
        return [...prev.slice(0, -1), { msg: msg || last.msg, status }];
      });
    };

    try {
      addStep("正在初始化跨时空检索协议...");
      
      const metaRes = await fetch("/api/metadata", { signal });
      const currentMeta = await metaRes.json();
      setMetadata(currentMeta);
      
      const provider = currentMeta.activeProvider || "gemini";
      const modelId = provider === "gemini" ? currentMeta.geminiModelId : currentMeta.aliyunModelId;

      if (!modelId) {
        throw new Error(`请先在后台配置 ${provider === 'gemini' ? 'Gemini' : 'Aliyun'} 模型 ID`);
      }
      updateLastStep('success');

      addStep(`正在识别人物身份: ${source} 与 ${target}...`);
      
      const callAIProxy = async (prompt: string, responseFormat: 'text' | 'json' = 'json', schema?: any) => {
        const res = await fetch("/api/ai/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, responseFormat, schema }),
            signal
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "AI 服务异常");
        }
        const data = await res.json();
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

      const [srcValid, tgtValid] = await Promise.all([validate(source), validate(target)]);
      
      if (!srcValid.accepted) throw new Error(`起点人物无效: ${srcValid.reason || '原因未知'}`);
      if (!tgtValid.accepted) throw new Error(`终点人物无效: ${tgtValid.reason || '原因未知'}`);
      
      const normalizedSource = srcValid.normalizedName || source;
      const normalizedTarget = tgtValid.normalizedName || target;
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
    setError(null);
    setNewArrivals([]);
  };

  const content = (
    <div className={`flex flex-col ${isInline ? "h-auto max-h-full sm:max-h-[500px] w-full" : "max-h-[70vh] w-full"} overflow-y-auto custom-scrollbar transition-all duration-300 ${!isCollapsed ? (isInline ? "p-3 sm:p-4" : "p-6") : "p-0"}`}>
      {!isCollapsed && (
        <div className="flex flex-col h-full shrink-0">
          {!showResults && !isLoading && !error && !hideInputs && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col"
            >
              <div className={`grid grid-cols-1 ${isInline ? "gap-2 px-1" : "md:grid-cols-2 gap-4"} mb-4 shrink-0`}>
                <div className="space-y-1.5">
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono leading-none">起点人物</label>
                  {!isInline && (
                    <button 
                      onClick={handlePickRandomPair}
                      disabled={isPickingRandom || isLoading}
                      className="text-[10px] font-black text-indigo-500 hover:text-indigo-600 flex items-center gap-1 uppercase tracking-widest transition-all disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3 h-3 ${isPickingRandom ? 'animate-spin' : ''}`} />
                      随机选一对
                    </button>
                  )}
                </div>
                  <div className="relative px-0.5">
                    <input 
                      type="text"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                      placeholder="苏格拉底"
                      className="w-full pl-8 pr-3 py-2 bg-slate-100/50 border border-slate-200 rounded-xl text-[12px] focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all font-medium"
                    />
                    <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="px-0.5">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1 font-mono leading-none">终点人物</label>
                  </div>
                  <div className="relative px-0.5">
                    <input 
                      type="text"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      placeholder="乔布斯"
                      className="w-full pl-8 pr-3 py-2 bg-slate-100/50 border border-slate-200 rounded-xl text-[12px] focus:ring-2 focus:ring-indigo-500 focus:bg-white outline-none transition-all font-medium"
                    />
                    <User className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400" />
                  </div>
                </div>
              </div>

              <button 
                onClick={() => handleSearch()}
                disabled={isLoading || !source.trim() || !target.trim()}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-[12px] font-bold rounded-xl transition-all shadow-lg shadow-indigo-100 flex items-center justify-center gap-2 active:scale-[0.98] shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                开启跨时空探索
              </button>
            </motion.div>
          )}

          {isLoading && (
            <div className="flex-1 flex flex-col pt-4 overflow-hidden">
               <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-2xl border border-indigo-100 border-dashed mb-4 relative overflow-hidden">
                  {/* Pulse background */}
                  <motion.div 
                    className="absolute inset-0 bg-indigo-100/50"
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  
                  <Loader2 className="w-5 h-5 text-indigo-600 animate-spin relative z-10" />
                  <div className="flex-1 relative z-10">
                    <div className="text-[11px] font-black text-indigo-600 tracking-tight">AI 正在编织历史脉络...</div>
                    <div className="h-1.5 w-full bg-indigo-100/50 rounded-full mt-2 overflow-hidden">
                       <motion.div 
                         className="h-full bg-indigo-500"
                         initial={{ width: "0%" }}
                         animate={{ width: "100%" }}
                         transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                       />
                    </div>
                  </div>
                  
                  <button 
                    onClick={handleStop}
                    className="ml-2 p-2 bg-white/80 hover:bg-white text-red-500 rounded-xl shadow-sm border border-red-100 transition-all hover:scale-105 active:scale-95 group relative z-10"
                    title="停止探索"
                  >
                    <StopCircle className="w-4 h-4" />
                  </button>
               </div>
               <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pl-2 border-l-2 border-slate-100 mb-2">
                 {searchSteps.map((step, i) => (
                   <motion.div 
                     key={i}
                     initial={{ opacity: 0, x: -10 }}
                     animate={{ opacity: step.status === 'pending' ? 1 : 0.8, x: 0 }}
                     className="flex items-center gap-2"
                   >
                     <div className={`w-1.5 h-1.5 rounded-full ${step.status === 'success' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : (step.status === 'error' ? 'bg-red-500' : 'bg-indigo-400 animate-ping')}`} />
                     <span className={`text-[10px] font-medium transition-colors ${step.status === 'success' ? 'text-slate-500' : 'text-indigo-600'}`}>
                       {step.msg}
                       {step.status === 'success' && <span className="ml-1 text-[8px] opacity-60">✓</span>}
                     </span>
                   </motion.div>
                 ))}
               </div>
            </div>
          )}

          {error && (
            <div className="flex-1 flex flex-col items-center justify-center py-6 text-center animate-in fade-in zoom-in duration-300">
               <div className={`w-14 h-14 ${error.includes("中止") ? "bg-slate-100 text-slate-400" : "bg-red-50 text-red-500"} rounded-3xl flex items-center justify-center mb-4 shadow-sm`}>
                  {error.includes("中止") ? <Search className="w-7 h-7" /> : <AlertCircle className="w-7 h-7" />}
               </div>
               <h3 className="text-sm font-black text-slate-800 mb-2">{error.includes("中止") ? "探索已暂停" : "探索遭遇挑战"}</h3>
               <p className="text-[11px] text-slate-500 leading-relaxed px-4 mb-6 font-medium">{error}</p>
               <div className="flex gap-3">
                 <button 
                   onClick={() => handleSearch()}
                   className={`${error.includes("中止") ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-slate-900 text-white hover:bg-black"} px-6 py-2.5 text-[11px] font-black rounded-xl transition-all shadow-lg active:scale-95 uppercase tracking-widest`}
                 >
                   {error.includes("中止") ? "继续探索" : "重新尝试"}
                 </button>
                 <button 
                   onClick={clearResults}
                   className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[11px] font-black rounded-xl transition-all active:scale-95 uppercase tracking-widest"
                 >
                   返回
                 </button>
               </div>
            </div>
          )}

          {showResults && path && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">探索发现</h3>
                <button 
                  onClick={clearResults}
                  className="p-1.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-red-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4">
                {/* Path Summary Header */}
                <div className="p-4 bg-gradient-to-br from-indigo-50 to-white border border-indigo-100/50 rounded-2xl shadow-inner">
                   <div className="flex items-center gap-2 mb-2">
                      <Zap className="w-4 h-4 text-indigo-600" />
                      <h4 className="text-[10px] font-black text-slate-800 uppercase tracking-wider">时空关系探索报告</h4>
                   </div>
                   <p className="text-[11px] text-slate-500 leading-relaxed font-bold">
                    成功建立 <span className="text-indigo-600 px-1">{path[0].name}</span> 
                    与 <span className="text-indigo-600 px-1">{path[path.length-1].name}</span> 之间的历史连接。
                    链条共包含 <span className="text-indigo-600 px-1">{path.length}</span> 个节点，
                    跨越了深厚的历史脉络。
                   </p>
                </div>

                <div className="relative">
                  <div className="absolute top-[30px] bottom-[30px] left-[29px] w-[2px] bg-indigo-100/80 z-0"></div>
                  {path.map((step, i) => (
                    <div key={i} className="flex flex-col relative z-10">
                      {i > 0 && (
                        <div className="flex py-3 pl-[56px] pr-2 w-full">
                          <div className="w-full bg-indigo-50/80 px-4 py-2.5 rounded-xl text-[11px] font-medium text-indigo-600 border border-indigo-100/50 shadow-sm leading-relaxed text-center relative">
                            {step.type || "历史渊源"}
                          </div>
                        </div>
                      )}
                      
                      <motion.div 
                        whileHover={{ scale: 1.02 }}
                        className="w-full p-3 bg-white/95 border border-slate-200/80 rounded-2xl shadow-sm flex items-center justify-between group cursor-pointer hover:border-indigo-400 hover:shadow-indigo-100/50 transition-all relative"
                        onClick={() => {
                          // Selection is handled in parent via the path itself usually
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all shrink-0 ${newArrivals.includes(step.name) ? 'bg-emerald-600 text-white shadow-emerald-200' : 'bg-slate-50 text-indigo-500 group-hover:bg-indigo-600 group-hover:text-white shadow-sm ring-1 ring-slate-200/50'}`}>
                            <User className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 pr-2">
                            <span className="font-black text-slate-800 text-[12px] whitespace-nowrap block truncate">{step.name}</span>
                            <p className="text-[9px] text-slate-400 font-medium truncate">{newArrivals.includes(step.name) ? "AI 馆藏同步完成" : "历史跨度关联人物"}</p>
                          </div>
                        </div>
                        {newArrivals.includes(step.name) && (
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-md font-black text-[8px] uppercase tracking-tighter shrink-0">
                            <Sparkles className="w-2 h-2" />
                            <span>新收录</span>
                          </div>
                        )}
                      </motion.div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );

  if (isInline) {
    return (
      <div className={`flex flex-col transition-all duration-300 ${isCollapsed && isInline ? 'w-[160px] sm:w-[200px]' : (isInline ? 'w-[calc(100vw-2rem)] max-w-[280px] sm:w-[320px] sm:max-w-none' : 'w-full')}`}>
        {!hideHeader && (
          <div className="px-3 py-2 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => setIsCollapsed(!isCollapsed)}>
            <div className="flex items-center gap-1.5 pr-2">
              <Zap className="w-3 h-3 text-indigo-600 shrink-0" />
              <span className="text-[10px] font-bold text-slate-800 whitespace-nowrap">时空关系网络探索</span>
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
