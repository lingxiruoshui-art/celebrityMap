import React, { useState, useEffect, FormEvent, useRef } from "react";
import { X, RefreshCw, Trash2, Settings, Save, Sparkles, User, Search, Eye, UserPlus, ChevronLeft, ChevronRight, BookOpen, Zap, Info } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Person } from "../types";
import SpacetimeExplorer from "./SpacetimeExplorer";
import ConfirmDialog from "./ConfirmDialog";

interface AdminPanelProps {
  onClose: () => void;
  onAuthorized?: () => void;
}

type Tab = "archive" | "archive_plus" | "config";
type SortField = "created_at" | "views" | "name" | "category";
type SortOrder = "asc" | "desc";

export default function AdminPanel({ onClose, onAuthorized }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>("archive_plus");
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [adminPassword, setAdminPassword] = useState(localStorage.getItem("admin_password") || "");
  const [isAuthorized, setIsAuthorized] = useState(!!localStorage.getItem("admin_password"));
  const [loginError, setLoginError] = useState("");
  
  // Archive view states
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [isFetchingAuto, setIsFetchingAuto] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;
  const [colWidths, setColWidths] = useState({
    category: 120,
    views: 100,
    createdAt: 140
  });

  // Manual Fetcher states
  const [fetchSource, setFetchSource] = useState("");
  const [fetchTarget, setFetchTarget] = useState("");
  const [isGeneratingTarget, setIsGeneratingTarget] = useState(false);
  const explorerRef = useRef<{ start: () => void; clear: () => void } | null>(null);

  const startResize = (e: React.MouseEvent, col: keyof typeof colWidths) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colWidths[col];

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      setColWidths(prev => ({
        ...prev,
        [col]: Math.max(60, startWidth - delta)
      }));
    };

    const onMouseUp = () => {
      document.body.style.cursor = 'default';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handlePickRandom = async () => {
    setIsGeneratingTarget(true);
    explorerRef.current?.clear();
    try {
      const res = await fetch("/api/archiver/pick-target", { method: "POST" });
      const data = await res.json();
      if (data.sourceName) setFetchSource(data.sourceName);
      if (data.targetName) {
        setFetchTarget(data.targetName);
      } else {
        // Pool empty, ask AI
        const genRes = await fetch("/api/archiver/generate-target", { 
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceName: data.sourceName })
        });
        const genData = await genRes.json();
        if (genData.targetName) setFetchTarget(genData.targetName);
      }
    } catch(e) {
      console.error(e);
    } finally {
      setIsGeneratingTarget(false);
    }
  };

  useEffect(() => {
    if (activeTab === "archive_plus" && !fetchSource) {
      handlePickRandom();
    }
  }, [activeTab]);

  // Config states
  const [config, setConfig] = useState<any>({});
  const [remainingQuota, setRemainingQuota] = useState<number | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [autoFetchLogs, setAutoFetchLogs] = useState<{type:string, msg:string}[]>([]);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const [regeneratingName, setRegeneratingName] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info', msg: string } | null>(null);

  const showNotification = (type: 'success' | 'error' | 'info', msg: string) => {
    setNotification({ type, msg });
    setTimeout(() => setNotification(null), 3000);
  };

  // Confirm dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmData, setConfirmData] = useState({
    title: "",
    message: "",
    onConfirm: () => {},
    isDanger: true
  });

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [autoFetchLogs]);

  const adminHeaders = {
    "Content-Type": "application/json",
    "x-admin-password": adminPassword
  };

  const fetchArchive = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/archive");
      if (!res.ok) {
        console.error("Fetch archive failed", await res.text());
        return;
      }
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        setPeople(data.people);
      } else {
        console.error("Fetch archive returned non-JSON", await res.text());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/admin/config", { headers: adminHeaders });
      if (res.status === 401) {
        setIsAuthorized(false);
        return;
      }
      if (res.ok) {
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await res.json();
          setConfig(data);
          setIsAuthorized(true);
          if (onAuthorized) onAuthorized();
          
          // Also fetch remaining quota
          const quotaRes = await fetch("/api/usage/remaining");
          const quotaData = await quotaRes.json();
          setRemainingQuota(quotaData.remaining);
        } else {
          console.error("Fetch config returned non-JSON");
        }
      } else {
        console.error("Fetch config failed", await res.text());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword })
      });
      if (res.ok) {
        localStorage.setItem("admin_password", adminPassword);
        setIsAuthorized(true);
        if (onAuthorized) onAuthorized();
        fetchConfig();
        setLoginError("");
      } else {
        setLoginError("密码错误");
      }
    } catch (e) {
      setLoginError("连接失败");
    }
  };

  useEffect(() => {
    fetchArchive();
    if (adminPassword) {
      fetchConfig();
    }
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortField, sortOrder]);

  const regeneratePerson = async (name: string) => {
    setRegeneratingName(name);
    let errorMsg = '';
    try {
      const res = await fetch("/api/archive-figure", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({ personName: name, stream: true })
      });
      
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response");
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'error') {
                 errorMsg = data.msg;
              }
            } catch(e) {}
          }
        }
      }
      if (errorMsg) throw new Error(errorMsg);
      showNotification('success', `人物 [${name}] 已重新生成`);
      fetchArchive();
    } catch(e: any) {
      showNotification('error', e.message || '重新生成失败');
    } finally {
      setRegeneratingName(null);
    }
  };

  const deletePerson = async (id: number) => {
    setConfirmData({
      title: "删除人物",
      message: "确定要删除此人及其所有关系吗？此操作不可逆。",
      isDanger: true,
      onConfirm: async () => {
        setIsLoading(true);
        try {
          const res = await fetch(`/api/admin/people/${id}`, { 
            method: "DELETE",
            headers: adminHeaders
          });
          if (res.ok) {
            setSelectedIds(prev => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            fetchArchive();
            showNotification('success', '人物及其关联已成功物理删除');
          }
          else showNotification('error', '删除失败');
        } catch (e) {
          console.error(e);
          showNotification('error', '连接服务器失败');
        } finally {
          setIsLoading(false);
          setConfirmOpen(false);
        }
      }
    });
    setConfirmOpen(true);
  };

  const batchDelete = async () => {
    if (selectedIds.size === 0) return;
    
    setConfirmData({
      title: "批量删除",
      message: `确定要删除选中的 ${selectedIds.size} 个人物吗？此操作不可撤销。`,
      isDanger: true,
      onConfirm: async () => {
        setIsLoading(true);
        try {
          const res = await fetch("/api/admin/people/batch-delete", {
            method: "POST",
            headers: adminHeaders,
            body: JSON.stringify({ ids: Array.from(selectedIds) })
          });
          if (res.ok) {
            setSelectedIds(new Set());
            fetchArchive();
            showNotification('success', '选中的人物已全部物理删除');
          } else {
            showNotification('error', '批量删除请求失败');
          }
        } catch (e) {
          console.error(e);
          showNotification('error', '连接服务器失败');
        } finally {
          setIsLoading(false);
          setConfirmOpen(false);
        }
      }
    });
    setConfirmOpen(true);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === paginatedPeople.length && paginatedPeople.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedPeople.map(p => p.id)));
    }
  };

  const toggleSelect = (id: number) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };
  
  const handleAutoFetch = async () => {
    if (isFetchingAuto) return;
    setIsFetchingAuto(true);
    setAutoFetchLogs([]);
    
    try {
      const res = await fetch("/api/archive-figure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personName: "", stream: true })
      });
      
      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'result') {
                 setAutoFetchLogs(prev => [...prev, { type: 'success', msg: '归档完成，刷新列表...' }]);
                 await fetchArchive();
              } else {
                 setAutoFetchLogs(prev => [...prev, data]);
              }
            } catch(e) {}
          }
        }
      }
    } catch (e) {
      setAutoFetchLogs(prev => [...prev, {type: 'error', msg: "网络错误: " + e}]);
    } finally {
      setIsFetchingAuto(false);
    }
  };

  const saveConfig = async (key: string, value: string) => {
    setSavingKey(key);
    const prevConfig = { ...config };
    const newConfig = { ...prevConfig, [key]: value };
    
    // Optimistic update for immediate feedback
    setConfig(newConfig);
    
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(newConfig)
      });
      if (!res.ok) {
        throw new Error("Save failed");
      }
      showNotification('success', '配置项已实时更新并固化至时空数据库');
      // Config is already set optimistically, but we could re-fetch to be sure
      // Or just assume it's good.
    } catch (e) {
      console.error(e);
      showNotification('error', "保存失败，请检查网络或重新登录");
      setConfig(prevConfig); // Rollback on error
    } finally {
      setSavingKey(null);
    }
  };

  const saveAllConfig = async () => {
    setSavingKey("all");
    try {
      const res = await fetch("/api/admin/config", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(config)
      });
      if (res.ok) {
        showNotification('success', '所有系统配置参数已成功持久化');
      } else {
        showNotification('error', '全量保存失败');
      }
    } catch (e) {
      console.error(e);
      showNotification('error', '连接服务器超时');
    } finally {
      setSavingKey(null);
    }
  };

  if (!isAuthorized) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/40">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-800">管理员验证</h2>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
              <X className="w-5 h-5" />
            </button>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2">输入后台密码</label>
              <input 
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                autoFocus
                placeholder="默认: admin"
              />
            </div>
            {loginError && <p className="text-xs text-red-500 font-bold">{loginError}</p>}
            <button 
              type="submit"
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all"
            >
              登录系统
            </button>
          </form>
        </div>
      </div>
    );
  }

  const filteredAndSortedPeople = people
    .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.category.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      let valA: any = a[sortField as keyof Person];
      let valB: any = b[sortField as keyof Person];
      
      if (typeof valA === 'string') {
        return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortOrder === 'asc' ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  const totalPages = Math.ceil(filteredAndSortedPeople.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedPeople = filteredAndSortedPeople.slice(startIndex, startIndex + itemsPerPage);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 xl:p-8 backdrop-blur-md bg-slate-900/40">
      <div className="bg-white lg:rounded-[2rem] rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-6xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-[85vh]">
        {/* Sidebar */}
        <div className="w-full md:w-56 shrink-0 border-b md:border-b-0 md:border-r border-slate-100 flex flex-col bg-slate-50/50">
          <div className="p-4 md:p-6 h-14 md:h-20 flex items-center gap-3 border-b border-slate-100 bg-white shrink-0">
             <Settings className="w-5 h-5 md:w-6 md:h-6 text-indigo-600" />
             <h2 className="font-bold text-slate-800 tracking-tight text-lg md:text-xl">后台管理</h2>
          </div>
          
          <nav className="p-2 md:p-4 flex flex-row md:flex-col gap-2 space-y-0 md:space-y-2 overflow-x-auto custom-scrollbar shrink-0 bg-white md:bg-transparent">
            <button 
              onClick={() => setActiveTab("archive_plus")}
              className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-xl md:rounded-2xl text-xs md:text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'archive_plus' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm border border-transparent hover:border-slate-200'}`}
            >
              <UserPlus className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
              <span>时空入库</span>
            </button>
            <button 
              onClick={() => setActiveTab("archive")}
              className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-xl md:rounded-2xl text-xs md:text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'archive' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm border border-transparent hover:border-slate-200'}`}
            >
              <BookOpen className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
              <span>馆藏管理</span>
            </button>
            <button 
              onClick={() => setActiveTab("config")}
              className={`flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 rounded-xl md:rounded-2xl text-xs md:text-sm font-bold transition-all whitespace-nowrap ${activeTab === 'config' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-500 hover:bg-white hover:text-slate-800 hover:shadow-sm border border-transparent hover:border-slate-200'}`}
            >
              <Settings className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
              <span>系统配置</span>
            </button>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col min-w-0 bg-white relative">
          <AnimatePresence>
            {notification && (
              <motion.div
                initial={{ opacity: 0, y: -20, x: "-50%" }}
                animate={{ opacity: 1, y: 0, x: "-50%" }}
                exit={{ opacity: 0, y: -20, x: "-50%" }}
                className={`absolute top-6 left-1/2 z-[70] px-5 py-2.5 rounded-full shadow-2xl font-bold text-sm flex items-center gap-2 border backdrop-blur-md whitespace-nowrap ${
                  notification.type === 'success' 
                  ? 'bg-emerald-500/95 text-white border-emerald-400' 
                  : notification.type === 'error'
                  ? 'bg-red-500/95 text-white border-red-400'
                  : 'bg-indigo-500/95 text-white border-indigo-400'
                }`}
              >
                {notification.type === 'success' ? <Sparkles className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                {notification.msg}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="p-6 h-20 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
            <div className="flex items-center gap-4">
              <h3 className="font-bold text-xl text-slate-800">
                {activeTab === 'archive_plus' ? '时空入库' : activeTab === 'archive' ? '馆藏管理' : '系统配置'}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {activeTab === 'config' && (
                <button
                  onClick={saveAllConfig}
                  disabled={savingKey !== null}
                  title="保存所有设置"
                  className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all disabled:opacity-50"
                >
                  {savingKey === 'all' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-5 h-5" />}
                </button>
              )}
              <button onClick={onClose} className="p-3 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50/30 p-8">
          {activeTab === "archive" && (
            <div className="space-y-6 animate-in fade-in duration-500">
              
              <div className="flex justify-end pr-2">
                <div className="relative w-full max-w-sm group">
                  <input 
                    type="text"
                    placeholder="搜索已收录人物..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 outline-none transition-all placeholder:text-slate-400 group-hover:border-slate-300"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                </div>
              </div>

              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-3">
                  {selectedIds.size > 0 && (
                    <button 
                      onClick={batchDelete}
                      className="px-3 py-1.5 bg-red-100 text-red-600 hover:bg-red-200 rounded-lg text-xs font-bold transition-all flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除已选 ({selectedIds.size})
                    </button>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto shadow-sm">
                <table className="w-full table-auto text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-bold text-slate-500 tracking-wider bg-slate-50 select-none">
                      <th className="px-4 py-3 w-16">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          checked={paginatedPeople.length > 0 && selectedIds.size === paginatedPeople.length}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="py-3 px-2 w-16 text-center whitespace-nowrap">头像</th>
                      <th className="py-3 px-4 cursor-pointer hover:text-indigo-600 whitespace-nowrap" onClick={() => toggleSort("name")}>
                        名字 {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="py-3 px-4 cursor-pointer hover:text-indigo-600 whitespace-nowrap" onClick={() => toggleSort("category")}>
                        分类 {sortField === 'category' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="py-3 px-4 cursor-pointer hover:text-indigo-600 whitespace-nowrap" onClick={() => toggleSort("views")}>
                        访问量 {sortField === 'views' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="py-3 px-4 cursor-pointer hover:text-indigo-600 whitespace-nowrap" onClick={() => toggleSort("created_at")}>
                        入馆时间 {sortField === 'created_at' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="py-3 px-4 w-24 text-center whitespace-nowrap">管理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPeople.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-12 text-center text-slate-400 italic">没有找到匹配的人物。</td>
                      </tr>
                    ) : paginatedPeople.map((p, index) => (
                      <tr key={p.id} className="hover:bg-slate-50 border-b border-slate-100 last:border-b-0 transition-colors group">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <input 
                              type="checkbox" 
                              checked={selectedIds.has(p.id)} 
                              onChange={() => toggleSelect(p.id)} 
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" 
                            />
                            <span className="text-sm font-bold text-slate-400 font-mono">{startIndex + index + 1}.</span>
                          </div>
                        </td>
                        <td className="px-2 py-3">
                          <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 text-slate-300 flex items-center justify-center overflow-hidden border border-slate-200">
                            {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : <User className="w-5 h-5" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800 text-sm whitespace-nowrap">{p.name}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{p.category}</td>
                        <td className="px-4 py-3 text-sm font-mono text-slate-600 whitespace-nowrap">{p.views}</td>
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                          {new Date((p as any).created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button 
                              onClick={() => regeneratePerson(p.name)} 
                              title="重新生成简介" 
                              disabled={regeneratingName === p.name}
                              className={`p-2 rounded-lg transition-colors ${regeneratingName === p.name ? 'text-indigo-600 bg-indigo-50' : 'text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50'}`}
                            >
                              <Sparkles className={`w-4 h-4 ${regeneratingName === p.name ? 'animate-spin' : ''}`} />
                            </button>
                            <button onClick={() => deletePerson(p.id)} title="删除" className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {totalPages > 1 && (
                <div className="flex items-center justify-between bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm">
                  <div className="text-xs text-slate-500 font-medium">
                    显示 {startIndex + 1} 到 {Math.min(startIndex + itemsPerPage, filteredAndSortedPeople.length)} 条，共 {filteredAndSortedPeople.length} 条
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1 rounded bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    {Array.from({ length: totalPages }).map((_, i) => {
                      const p = i + 1;
                      if (p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)) {
                        return (
                          <button
                            key={p}
                            onClick={() => setCurrentPage(p)}
                            className={`w-8 h-8 rounded text-xs font-bold transition-colors ${currentPage === p ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600'}`}
                          >
                            {p}
                          </button>
                        );
                      } else if (p === currentPage - 2 || p === currentPage + 2) {
                        return <span key={p} className="w-8 h-8 flex items-center justify-center text-xs text-slate-400">...</span>;
                      }
                      return null;
                    })}
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-1 rounded bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-50 transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "archive_plus" && (
            <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
              {autoFetchLogs.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 overflow-hidden">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-[10px] font-black uppercase tracking-widest text-slate-400">采集日志</h5>
                    <button onClick={() => setAutoFetchLogs([])} className="text-[10px] text-slate-400 hover:text-red-500 font-bold">清空</button>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-1 font-mono text-[10px]" ref={logsContainerRef}>
                    {autoFetchLogs.map((log, i) => (
                      <div key={i} className={`flex gap-2 ${log.type === 'error' ? 'text-red-500' : log.type === 'success' ? 'text-emerald-500' : 'text-slate-500'}`}>
                        <span className="shrink-0 opacity-50">[{new Date().toLocaleTimeString()}]</span>
                        <span className="font-bold">{log.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden p-8">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-1.5 h-6 bg-indigo-500 rounded-full"></div>
                  <h4 className="text-slate-800 font-bold text-lg tracking-tight leading-none">时空采集配置</h4>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-4 mb-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">起点人物 (已在库)</label>
                    <div className="p-3 bg-slate-50/50 border border-slate-100 rounded-xl flex items-center gap-3 transition-all">
                        <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center text-slate-300 border border-slate-200 shadow-sm">
                          <User className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-800 font-bold text-sm truncate tracking-tight">{fetchSource || "加载中..."}</div>
                          <div className="text-[8px] text-slate-400 font-bold uppercase tracking-widest mt-0.5"> Verified Source </div>
                        </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center md:pt-5">
                      <div className="w-8 h-8 rounded-full bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-300">
                        <ChevronRight className="w-4 h-4" />
                      </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">目标人物 (拟收录)</label>
                    <div className="relative group/input">
                      <input 
                        type="text"
                        value={fetchTarget}
                        onChange={(e) => setFetchTarget(e.target.value)}
                        placeholder="输入拟收录人物..."
                        className="w-full pl-10 pr-4 py-3 bg-slate-50/50 border border-slate-100 rounded-xl text-slate-800 font-bold text-sm focus:ring-4 focus:ring-indigo-500/5 focus:bg-white focus:border-indigo-500/20 outline-none transition-all placeholder:text-slate-300 tracking-tight"
                      />
                      <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-300 transition-all">
                          <Search className="w-3.5 h-3.5" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 mb-6">
                  <button 
                    onClick={handlePickRandom}
                    disabled={isGeneratingTarget}
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all border border-slate-200 disabled:opacity-50 active:scale-95"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingTarget ? 'animate-spin text-indigo-500' : ''}`} />
                    随机更换
                  </button>
                  <button 
                    onClick={() => explorerRef.current?.start(fetchSource, fetchTarget)}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-indigo-100 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    开启跨时空探索
                  </button>
                </div>

                <div className="bg-slate-50/50 rounded-3xl border border-slate-100 overflow-hidden shadow-inner">
                  <SpacetimeExplorer 
                    ref={explorerRef}
                    isInline={true}
                    initialSource={fetchSource}
                    initialTarget={fetchTarget}
                    autoStart={false}
                    hideInputs={true}
                    hideHeader={true}
                    onClose={() => {}}
                    onRefreshArchive={fetchArchive}
                    onSelectPerson={() => {}}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === "config" && (
            <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500 pb-12">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Google Gemini Card */}
                <div className={`bg-white p-6 rounded-3xl border-2 transition-all shadow-sm flex flex-col h-full ${config.active_model_provider === 'gemini' ? 'border-indigo-500 ring-4 ring-indigo-50' : 'border-slate-100 hover:border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${config.active_model_provider === 'gemini' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-100 text-slate-400'}`}>
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800">Google Gemini</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">高级多模态模型</p>
                      </div>
                    </div>
                    {config.active_model_provider === 'gemini' ? (
                      <div className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 border border-indigo-100">
                        <div className="w-1.5 h-1.5 bg-indigo-600 rounded-full animate-pulse"></div>
                        当前激活
                      </div>
                    ) : (
                      <button 
                         onClick={() => saveConfig("active_model_provider", "gemini")}
                        disabled={savingKey !== null}
                        className="text-[10px] font-black text-slate-400 hover:text-indigo-600 uppercase tracking-widest transition-all hover:bg-slate-50 px-3 py-1 rounded-full border border-slate-100 flex items-center gap-2"
                      >
                        {savingKey === 'active_model_provider' ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                        激活此模型
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-4 flex-1">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-1">模型 ID</label>
                      <input 
                        type="text"
                        placeholder="gemini-1.5-flash"
                        value={config.gemini_model_id || ""}
                        onChange={(e) => setConfig({ ...config, gemini_model_id: e.target.value })}
                        onBlur={(e) => saveConfig("gemini_model_id", e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-1">Gemini API Key</label>
                      <input 
                        type="password"
                        placeholder="sk-..."
                        value={config.gemini_api_key || ""}
                        onChange={(e) => setConfig({ ...config, gemini_api_key: e.target.value })}
                        onBlur={(e) => saveConfig("gemini_api_key", e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300"
                      />
                    </div>
                  </div>
                </div>

                {/* Aliyun DashScope Card */}
                <div className={`bg-white p-6 rounded-3xl border-2 transition-all shadow-sm flex flex-col h-full ${config.active_model_provider === 'aliyun' ? 'border-orange-500 ring-4 ring-orange-50' : 'border-slate-100 hover:border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${config.active_model_provider === 'aliyun' ? 'bg-orange-500 text-white shadow-lg shadow-orange-200' : 'bg-slate-100 text-slate-400'}`}>
                        <RefreshCw className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-800">阿里百炼 (Qwen)</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">通义千问系列</p>
                      </div>
                    </div>
                    {config.active_model_provider === 'aliyun' ? (
                      <div className="bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 border border-orange-100">
                        <div className="w-1.5 h-1.5 bg-orange-600 rounded-full animate-pulse"></div>
                        当前激活
                      </div>
                    ) : (
                      <button 
                        onClick={() => saveConfig("active_model_provider", "aliyun")}
                        disabled={savingKey !== null}
                        className="text-[10px] font-black text-slate-400 hover:text-orange-500 uppercase tracking-widest transition-all hover:bg-slate-50 px-3 py-1 rounded-full border border-slate-100 flex items-center gap-2"
                      >
                        {savingKey === 'active_model_provider' ? <RefreshCw className="w-3 h-3 animate-spin" /> : null}
                        激活此模型
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-4 flex-1">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-1">模型 ID</label>
                      <input 
                        type="text"
                        placeholder="qwen-max"
                        value={config.aliyun_model_id || ""}
                        onChange={(e) => setConfig({ ...config, aliyun_model_id: e.target.value })}
                        onBlur={(e) => saveConfig("aliyun_model_id", e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 px-1">阿里百炼 API Key</label>
                      <input 
                        type="password"
                        placeholder="sk-..."
                        value={config.aliyun_api_key || ""}
                        onChange={(e) => setConfig({ ...config, aliyun_api_key: e.target.value })}
                        onBlur={(e) => saveConfig("aliyun_api_key", e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-orange-500 outline-none transition-all placeholder:text-slate-300"
                      />
                    </div>
                  </div>
                </div>

                {/* Performance & Quota Settings */}
                <div className="bg-white p-6 rounded-3xl border-2 border-slate-100 shadow-sm md:col-span-1">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">访问控制与配额</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">限制访客使用频率</p>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">访客每日探索限额</label>
                      {remainingQuota !== null && (
                        <div className="flex items-center gap-1.5 text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold">
                          <Zap className="w-2.5 h-2.5" />
                          今日剩余: {remainingQuota}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <input 
                        type="number"
                        value={config.guest_explore_limit || "5"}
                        onChange={(e) => setConfig({ ...config, guest_explore_limit: e.target.value })}
                        onBlur={(e) => saveConfig("guest_explore_limit", e.target.value)}
                        className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                      <div className="text-[10px] text-slate-400 font-bold">次/天</div>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <Info className="w-3 h-3 text-slate-300" />
                      <p className="text-[9px] text-slate-400 italic">东八区(北京时间) 00:00 自动重置。</p>
                    </div>
                  </div>
                </div>

                {/* Maintenance Card */}
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex flex-col h-full md:col-span-2">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">系统维护</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">修复与重置任务</p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-4 border border-orange-100 bg-orange-50/30 p-4 rounded-2xl">
                     <div className="flex-1">
                        <h5 className="text-sm font-bold text-slate-800 mb-1">修复损坏的立绘 / 照片转存</h5>
                        <p className="text-xs text-slate-500">如果发现人物列表中的图片加载失败或显示为空白（通常是因为防盗链或上传截断），请点击此按钮让服务器尝试重新拉取并存入 Cloudflare R2。</p>
                     </div>
                     <button 
                       onClick={async () => {
                         try {
                           showNotification('info', '已触发修复，请在稍后观察效果...');
                           const res = await fetch("/api/admin/repair-images", {
                                method: "POST",
                                headers: { "x-admin-password": adminPassword }
                           });
                           const data = await res.json();
                           if (data.success) {
                             showNotification('success', '修复任务在后台运行中，刷新页面查看效果。');
                           } else {
                             showNotification('error', data.error || '触发修复失败');
                           }
                         } catch(e) {
                             showNotification('error', '触发修复失败，网络错误');
                         }
                       }}
                       className="px-4 py-2.5 shrink-0 bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 font-bold text-xs rounded-xl shadow-sm transition-all"
                     >
                       开始修复
                     </button>
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
        </div>
      </div>
      <ConfirmDialog 
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmData.onConfirm}
        title={confirmData.title}
        message={confirmData.message}
        isDanger={confirmData.isDanger}
        isLoading={isLoading}
      />

      {/* Confirm Dialog is now above */}
    </div>
  );
}

