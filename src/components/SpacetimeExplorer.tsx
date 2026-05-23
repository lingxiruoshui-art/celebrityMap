import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react";
import { X, Search, ChevronRight, User, Loader2, Sparkles, AlertCircle, RefreshCw, Zap, ChevronUp, ChevronDown, RotateCcw } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface SpacetimeExplorerHandle {
  start: (overrideSource?: string, overrideTarget?: string) => void;
  clear: () => void;
}

interface SpacetimeExplorerProps {
  onClose: () => void;
  onRefreshArchive: () => void;
  onSelectPerson: (id: number, name?: string) => void;
  onPathFound?: (path: any[] | null) => void;
  isInline?: boolean;
  isAdmin?: boolean; 
  peopleNames?: string[];
}

export default forwardRef<SpacetimeExplorerHandle, SpacetimeExplorerProps>(function SpacetimeExplorer({ 
  onClose, 
  onSelectPerson, 
  onPathFound, 
  isInline,
  peopleNames = []
}, ref) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<any[] | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  
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

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!source && !target && peopleNames.length >= 2) {
      // Pick two distinct names if possible
      setSource(peopleNames[0]);
      setTarget(peopleNames[peopleNames.length - 1]);
    }
  }, [peopleNames, source, target]);

  const handleReset = () => {
    setSource("");
    setTarget("");
    setError(null);
    setPath(null);
    setSourceOptions([]);
    setTargetOptions([]);
    if (onPathFound) onPathFound(null);
  };

  useImperativeHandle(ref, () => ({
    start: (overrideSource?: string, overrideTarget?: string) => {
      handleSearch(overrideSource, overrideTarget);
    },
    clear: handleReset
  }));

  const handleSearch = async (overrideSource?: string, overrideTarget?: string) => {
    const finalSource = overrideSource || source;
    const finalTarget = overrideTarget || target;
    
    if (!finalSource || !finalTarget) {
      setError("请输入起点和终点人物");
      return;
    }

    setIsLoading(true);
    setError(null);
    setPath(null);
    setSourceOptions([]);
    setTargetOptions([]);
    if (onPathFound) onPathFound(null);

    if (abortControllerRef.current) {
        abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const res = await fetch("/api/public/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({ source: finalSource, target: finalTarget })
      });
      const data = await res.json() as any;
      
      if (!res.ok) {
         throw new Error(data.error || "搜索失败");
      }

      if (data.needsSelection) {
         setError("发现多个匹配项，请重新选择准确的人物名");
         if (data.sourceOptions && data.sourceOptions.length > 0) setSourceOptions(data.sourceOptions);
         if (data.targetOptions && data.targetOptions.length > 0) setTargetOptions(data.targetOptions);
         return;
      }

      if (data.status === 'success') {
         setSource(data.sourceName);
         setTarget(data.targetName);
         setPath(data.path);
         if (onPathFound) onPathFound(data.path);
      } else {
         throw new Error(data.error || "搜索失败");
      }
    } catch (err: any) {
       if (err.name !== 'AbortError') {
           setError(err.message);
       }
    } finally {
       setIsLoading(false);
    }
  };

  const handleRandomFill = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/archiver/random-pair");
      const data = await res.json() as any;
      if (data.sourceName && data.targetName) {
        setSource(data.sourceName);
        setTarget(data.targetName);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`flex flex-col bg-white h-full ${!isInline ? "shadow-2xl" : ""}`}>
      {/* Search Header */}
      <div className={`bg-white px-4 sm:px-5 ${isCollapsed ? 'py-1.5' : 'py-2 sm:py-2.5'} border-b border-slate-100 flex-none shrink-0 top-0 z-40 transition-all duration-300`} style={{ boxShadow: '0 4px 20px -10px rgba(0,0,0,0.05)' }}>
        <div className={`flex justify-between items-center ${isCollapsed ? '' : 'mb-2'}`}>
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Zap className="w-4 h-4 text-indigo-500" />
            时空关系网络探索
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleReset}
              className="p-1.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-indigo-600"
              title="复位"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="p-1.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-indigo-600"
              title={isCollapsed ? "展开" : "缩回"}
            >
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            {!isInline && (
              <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600 ml-1 pl-2 border-l border-slate-200">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {!isCollapsed && (
          <div className="space-y-2 pt-0 pb-1">
          <div className="grid grid-cols-2 gap-3">
            {/* Source Input */}
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
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
                <User className="absolute left-3 top-2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
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

            {/* Target Input */}
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
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
                <User className="absolute left-3 top-2 w-3.5 h-3.5 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
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
              {targetOptions.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1 border border-indigo-100 bg-indigo-50 p-1.5 rounded-lg">
                  <span className="text-[10px] text-slate-500 w-full mb-0.5">您是指：</span>
                  {targetOptions.map(opt => (
                    <button key={opt} onClick={() => { setTarget(opt); setTargetOptions([]); setError(null); }} className="text-[11px] font-bold bg-white hover:bg-slate-50 px-2 py-0.5 rounded-md text-indigo-600 border border-slate-200 shadow-sm transition-all active:scale-95">
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2.5 pt-1.5">
            <button
              onClick={handleRandomFill}
              disabled={isLoading}
              className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 text-[12px] font-bold rounded-xl transition-all border border-slate-200 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:hover:scale-100 shadow-sm"
            >
              {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-slate-400" />}
              <span className="hidden sm:inline">随机更换</span>
            </button>
            <button 
              onClick={() => handleSearch()}
              disabled={isLoading || !source || !target}
              className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white p-2 rounded-xl text-[12px] font-bold shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-1.5"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在检索本地数据库...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  开启探索
                </>
              )}
            </button>
          </div>
        </div>
        )}
      </div>

      {!isCollapsed && (
      <div className="flex-1 overflow-y-auto min-h-0 bg-slate-50/50 p-3 sm:p-4 custom-scrollbar relative">
        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-100 text-red-600 text-[12px] rounded-xl flex items-start gap-2 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed font-medium">{error}</span>
          </div>
        )}

        {path && path.length > 0 && (
          <div className="p-2 sm:p-3">
            <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              时空折叠路径已建立
            </h3>
            
            <div className="space-y-1 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
              {path.map((item, idx) => {
                const isStart = idx === 0;
                const isEnd = idx === path.length - 1;
                
                return (
                  <div key={idx} className="relative flex items-center group">
                    <div className="flex items-center w-full my-2">
                      <div className={`relative flex items-center justify-center w-6 h-6 rounded-full border-2 bg-white z-10 shrink-0
                        ${isStart ? 'border-indigo-500' : isEnd ? 'border-purple-500' : 'border-slate-300'}
                        shadow-sm transition-transform duration-300 group-hover:scale-110`}
                      >
                        <div className={`w-2 h-2 rounded-full ${isStart ? 'bg-indigo-500' : isEnd ? 'bg-purple-500' : 'bg-slate-300'}`} />
                      </div>
                      
                      <div className="flex-1 pl-4 flex flex-col items-start min-w-0">
                        <button 
                          onClick={() => onSelectPerson(item.id, item.name)}
                          className={`text-left text-[14px] font-bold hover:text-indigo-600 cursor-pointer transition-colors truncate max-w-full
                            ${isStart ? 'text-indigo-600' : isEnd ? 'text-purple-600' : 'text-slate-700'}`}
                        >
                          {item.name}
                        </button>
                        {!isStart && <span className="text-[11px] font-medium text-slate-400 mt-0.5 leading-relaxed">{item.type}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        
        {!path && !isLoading && !error && (
            <div className="flex flex-col items-center justify-center text-center p-4 text-slate-400 py-4">
              <Search className="w-8 h-8 mb-2 text-slate-200" strokeWidth={1} />
              <p className="text-[13px] font-medium text-slate-400">目前已有大量历史人物数据入库</p>
              <p className="text-[11px] text-slate-400/70 mt-1">输入任意两位已有历史人物，即刻建立关联</p>
            </div>
        )}
      </div>
      )}
    </div>
  );
});
