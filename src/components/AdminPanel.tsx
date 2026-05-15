import React, { useState, useEffect, FormEvent, useRef } from "react";
import { X, RefreshCw, Trash2, Settings, Save, Sparkles, User, Search, Eye, UserPlus, ChevronLeft, ChevronRight, BookOpen, Zap, Info, Database, Library, Activity, PlusCircle, SlidersHorizontal, ShieldCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Person } from "../types";
import AdminSpacetimeExplorer, { SpacetimeExplorerHandle } from "./AdminSpacetimeExplorer";
import ConfirmDialog from "./ConfirmDialog";

interface AdminPanelProps {
  onClose: () => void;
  onAuthorized?: () => void;
  onPreviewPerson?: (id: number) => void;
}

type Tab = "archive" | "archive_plus" | "config";
type SortField = "created_at" | "views" | "name" | "category";
type SortOrder = "asc" | "desc";

export default function AdminPanel({ onClose, onAuthorized, onPreviewPerson }: AdminPanelProps) {
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
  const explorerRef = useRef<SpacetimeExplorerHandle | null>(null);

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

  // Config states
  const [config, setConfig] = useState<any>({});
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
        const data = await res.json() as any;
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
    if (activeTab === 'archive') {
      fetchArchive();
    }
  }, [activeTab]);

  useEffect(() => {
    if (adminPassword) {
      fetchConfig();
    }
  }, []);

  // Polling for config and archive
  useEffect(() => {
    if (!isAuthorized) return;

    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/explore/status", { headers: adminHeaders });
        if (res.ok) {
          const data = await res.json() as any;
          setIsLoading(data && data.status === 'running');
        }
      } catch (e) {}
    };

    const interval = setInterval(() => {
      fetchConfig();
      fetchStatus();
      if (activeTab === "archive") {
        fetchArchive();
      }
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [isAuthorized, activeTab]);

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
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-md bg-slate-900/40">
        <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-slate-800">管理员验证</h2>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 xl:p-8 backdrop-blur-md bg-slate-900/40 font-sans">
      <div className="bg-white lg:rounded-[2rem] rounded-2xl shadow-2xl shadow-slate-900/20 w-full max-w-7xl overflow-hidden flex flex-col md:flex-row h-[90vh] md:h-[88vh]">
        {/* Sidebar */}
        <div className="w-full md:w-48 shrink-0 border-b md:border-b-0 md:border-r border-slate-100 flex flex-col bg-slate-50/50">
          <div className="p-4 md:p-5 h-[70px] md:h-20 flex items-center justify-between border-b border-slate-100 bg-white shrink-0">
             <div className="flex items-center gap-3">
               <ShieldCheck className="w-6 h-6 text-indigo-600" />
               <h2 className="font-bold text-slate-800 tracking-tight text-base md:text-lg">后台管理</h2>
             </div>
             <button onClick={onClose} className="md:hidden p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                <X className="w-5 h-5" />
             </button>
          </div>
          
          <nav className="p-2 md:p-3 flex flex-row md:flex-col gap-1.5 space-y-0 md:space-y-1.5 overflow-x-auto custom-scrollbar shrink-0 bg-white md:bg-transparent">
            <button 
              onClick={() => setActiveTab("archive_plus")}
              className={`flex items-center justify-between gap-2 md:gap-2.5 px-3 py-2 md:px-3 text-xs md:text-[13px] font-bold transition-all whitespace-nowrap rounded-lg md:rounded-xl ${activeTab === 'archive_plus' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'text-slate-500 hover:bg-white hover:text-slate-800 border border-transparent hover:border-slate-200'}`}
            >
              <div className="flex items-center gap-2">
                <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                <span>时空入库</span>
              </div>
            </button>
            <button 
              onClick={() => setActiveTab("archive")}
              className={`flex items-center gap-2 md:gap-2.5 px-3 py-2 md:px-3 text-xs md:text-[13px] font-bold transition-all whitespace-nowrap rounded-lg md:rounded-xl ${activeTab === 'archive' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'text-slate-500 hover:bg-white hover:text-slate-800 border border-transparent hover:border-slate-200'}`}
            >
              <Library className="w-3.5 h-3.5 shrink-0" />
              <span>馆藏管理</span>
            </button>
            <button 
              onClick={() => setActiveTab("config")}
              className={`flex items-center gap-2 md:gap-2.5 px-3 py-2 md:px-3 text-xs md:text-[13px] font-bold transition-all whitespace-nowrap rounded-lg md:rounded-xl ${activeTab === 'config' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-100' : 'text-slate-500 hover:bg-white hover:text-slate-800 border border-transparent hover:border-slate-200'}`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
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

          <div className="p-5 h-20 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
            <div className="flex items-center gap-3">
              {activeTab === 'archive_plus' && <PlusCircle className="w-6 h-6 text-indigo-600" />}
              {activeTab === 'archive' && <Library className="w-6 h-6 text-indigo-600" />}
              {activeTab === 'config' && <SlidersHorizontal className="w-6 h-6 text-indigo-600" />}
              <h3 className="font-bold text-lg text-slate-800 tracking-tight">
                {activeTab === 'archive_plus' ? '时空入库' : activeTab === 'archive' ? '馆藏管理' : '系统配置'}
              </h3>
            </div>
            <div className="flex items-center gap-2 sm:gap-4">
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
              <button onClick={onClose} className="hidden md:flex p-2.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className={`flex-1 ${activeTab === 'archive_plus' ? 'overflow-hidden flex flex-col p-4 sm:p-6 pb-2 sm:pb-2 pt-2 sm:pt-4' : 'overflow-y-auto p-5'} bg-slate-50/30`}>
          <div className={activeTab === "archive" ? "space-y-6 animate-in fade-in duration-500 pb-8" : "hidden"}>
              
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
                        <td 
                          className="px-4 py-3 font-bold text-slate-800 text-sm whitespace-nowrap cursor-pointer hover:text-indigo-600 transition-colors group-hover:pl-5"
                          onClick={() => onPreviewPerson?.(p.id)}
                          title="点击在前台查看"
                        >
                          <div className="flex items-center gap-2">
                             {p.name}
                             <Eye className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </td>
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

          <div className={activeTab === "archive_plus" ? "h-full flex flex-col animate-in fade-in duration-500 overflow-hidden pb-8" : "hidden"}>
              <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mt-1">
                <div className="flex-1 min-h-0 bg-white rounded-2xl overflow-hidden">
                  <AdminSpacetimeExplorer 
                    ref={explorerRef}
                    isInline={true}
                    isPane={true}
                    showLogs={true}
                    autoStart={false}
                    hideInputs={false}
                    hideHeader={true}
                    isAdmin={true}
                    allowAdminControls={true}
                    onClose={() => {}}
                    onRefreshArchive={fetchArchive}
                    onSelectPerson={(id, name) => {
                      if (id > 0) {
                        onPreviewPerson?.(id);
                      } else if (name) {
                        const p = people.find(person => person.name === name);
                        if (p) onPreviewPerson?.(p.id);
                      }
                    }}
                    peopleNames={people.map(p => p.name)}
                  />
                </div>
              </div>
            </div>

              <div className={activeTab === "config" ? "max-w-5xl mx-auto space-y-4 animate-in fade-in duration-500 pb-8 uppercase tracking-tight" : "hidden"}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Google Gemini Card */}
                <div className={`bg-white p-4 rounded-2xl border-2 transition-all shadow-sm flex flex-col h-full ${config.active_model_provider === 'gemini' ? 'border-indigo-500 ring-4 ring-indigo-50/50' : 'border-slate-100 hover:border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${config.active_model_provider === 'gemini' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-100 text-slate-400'}`}>
                        <Sparkles className="w-4.5 h-4.5" />
                      </div>
                      <div>
                        <h4 className="text-[13px] font-bold text-slate-800">Google Gemini</h4>
                        <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest leading-none">多模态旗舰</p>
                      </div>
                    </div>
                    {config.active_model_provider === 'gemini' ? (
                      <div className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 border border-indigo-100">
                        <div className="w-1 h-1 bg-indigo-600 rounded-full animate-pulse"></div>
                        ACTIVE
                      </div>
                    ) : (
                      <button 
                         onClick={() => saveConfig("active_model_provider", "gemini")}
                        disabled={savingKey !== null}
                        className="text-[9px] font-black text-slate-400 hover:text-indigo-600 uppercase tracking-widest transition-all hover:bg-slate-50 px-2.5 py-0.5 rounded-full border border-slate-100 flex items-center gap-1.5"
                      >
                        {savingKey === 'active_model_provider' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
                        激活
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-3 flex-1 px-1">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">模型 ID</label>
                      <input 
                        type="text"
                        placeholder="gemini-1.5-flash"
                        value={config.gemini_model_id || ""}
                        onChange={(e) => setConfig({ ...config, gemini_model_id: e.target.value })}
                        onBlur={(e) => saveConfig("gemini_model_id", e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">API KEY</label>
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
                <div className={`bg-white p-4 rounded-2xl border-2 transition-all shadow-sm flex flex-col h-full ${config.active_model_provider === 'aliyun' ? 'border-orange-500 ring-4 ring-orange-50/50' : 'border-slate-100 hover:border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${config.active_model_provider === 'aliyun' ? 'bg-orange-500 text-white shadow-lg shadow-orange-100' : 'bg-slate-100 text-slate-400'}`}>
                        <Zap className="w-4.5 h-4.5" />
                      </div>
                      <div>
                        <h4 className="text-[13px] font-bold text-slate-800">阿里百炼 (QWEN)</h4>
                        <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest leading-none">通义大模型</p>
                      </div>
                    </div>
                    {config.active_model_provider === 'aliyun' ? (
                      <div className="bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1 border border-orange-100">
                        <div className="w-1 h-1 bg-orange-600 rounded-full animate-pulse"></div>
                        ACTIVE
                      </div>
                    ) : (
                      <button 
                        onClick={() => saveConfig("active_model_provider", "aliyun")}
                        disabled={savingKey !== null}
                        className="text-[9px] font-black text-slate-400 hover:text-orange-500 uppercase tracking-widest transition-all hover:bg-slate-50 px-2.5 py-0.5 rounded-full border border-slate-100 flex items-center gap-1.5"
                      >
                        {savingKey === 'active_model_provider' ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : null}
                        激活
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-3 flex-1 px-1">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">模型 ID</label>
                      <input 
                        type="text"
                        placeholder="qwen-max"
                        value={config.aliyun_model_id || ""}
                        onChange={(e) => setConfig({ ...config, aliyun_model_id: e.target.value })}
                        onBlur={(e) => saveConfig("aliyun_model_id", e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-widest text-slate-400">API KEY</label>
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
              </div>

              {/* 后台自动探索配置 */}
              <div className="bg-white p-5 md:p-6 rounded-2xl border-2 border-slate-100 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-50 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                      <Activity className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">后台自动探索控制</h4>
                      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none mt-1">定时任务自动同步</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative">
                        <input 
                          type="checkbox"
                          checked={config.cron_interval_enabled === true || config.cron_interval_enabled === 'true'}
                          onChange={(e) => saveConfig("cron_interval_enabled", e.target.checked ? "true" : "false")}
                          className="sr-only"
                        />
                        <div className={`w-10 h-5 rounded-full transition-colors ${(config.cron_interval_enabled === true || config.cron_interval_enabled === 'true') ? 'bg-indigo-600' : 'bg-slate-200'}`}></div>
                        <div className={`absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-transform ${(config.cron_interval_enabled === true || config.cron_interval_enabled === 'true') ? 'translate-x-5' : ''}`}></div>
                      </div>
                      <span className="text-xs font-bold text-slate-600 group-hover:text-indigo-600 transition-colors">开启间隔限制</span>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 sm:gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                          小时
                        </label>
                        <input 
                          type="number"
                          min="0"
                          value={config.cron_interval_hours || 0}
                          onChange={(e) => setConfig({ ...config, cron_interval_hours: parseInt(e.target.value) || 0 })}
                          onBlur={(e) => saveConfig("cron_interval_hours", e.target.value)}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex justify-between">
                          <span>分钟</span>
                          <span className="text-indigo-500/60 font-black">最少 15</span>
                        </label>
                        <input 
                          type="number"
                          min="0"
                          max="59"
                          value={config.cron_interval_minutes || 0}
                          onChange={(e) => setConfig({ ...config, cron_interval_minutes: parseInt(e.target.value) || 0 })}
                          onBlur={(e) => {
                             let val = parseInt(e.target.value) || 0;
                             if (val < 15 && (!config.cron_interval_hours || config.cron_interval_hours === 0)) val = 15;
                             saveConfig("cron_interval_minutes", String(val));
                          }}
                          className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none"
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed italic">
                      * 定时探索任务将按照此间隔周期性尝试触发。若手动点击“开启探索”，则不受此处的间隔限制影响。
                    </p>
                  </div>

                  <div className="bg-slate-50/80 rounded-2xl p-4 md:p-5 border border-slate-100 flex flex-col justify-center min-h-[80px]">
                    <div className="flex items-center gap-2 mb-2">
                       <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                       <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">上次收到同步指令</span>
                    </div>
                    <div className="text-sm md:text-base font-mono font-bold text-slate-700 tracking-tight">
                       {config.last_cron_trigger_time ? new Date(parseInt(config.last_cron_trigger_time)).toLocaleString('zh-CN', {
                         year: 'numeric',
                         month: '2-digit',
                         day: '2-digit',
                         hour: '2-digit',
                         minute: '2-digit',
                         second: '2-digit',
                         hour12: false
                       }) : "尚无记录"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
    </div>
  );
}

