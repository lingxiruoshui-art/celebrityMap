import { useEffect, useState, useMemo } from "react";
import {
  Loader2,
  Sparkles,
  BookOpen,
  Settings,
  Zap,
  X,
  Search,
  User,
  Heart,
  ChevronRight,
  ChevronLeft,
  CircleDashed,
  LogOut,
  Network,
  Info,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Person, ArchiveData } from "./types";
import NetworkGraph from "./components/NetworkGraph";
import AdminPanel from "./components/AdminPanel";
import SpacetimeExplorer from "./components/SpacetimeExplorer";
import FeedbackModal from "./components/FeedbackModal";

import AnimatedLogo from "./components/AnimatedLogo";

export default function App() {
  const [data, setData] = useState<ArchiveData>({
    people: [],
    relationships: [],
  });
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isSixDegreesOpen, setIsSixDegreesOpen] = useState(true);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingArchive, setIsLoadingArchive] = useState(true);
  const [discoveryPath, setDiscoveryPath] = useState<
    { name: string; type?: string }[] | null
  >(null);
  const [pendingSelectName, setPendingSelectName] = useState<string | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  useEffect(() => {
    if (pendingSelectName && data.people.length > 0) {
      const person = data.people.find(p => p.name === pendingSelectName);
      if (person) {
        setSelectedPersonId(person.id);
        setPendingSelectName(null);
      }
    }
  }, [pendingSelectName, data.people]);
  const [connectionPage, setConnectionPage] = useState(1);
  const [isAuthorized, setIsAuthorized] = useState(
    !!localStorage.getItem("admin_password"),
  );

  const incrementView = async (id: number) => {
    try {
      // 避免单次探索会话内切换、刷新等操作导致访问量异常刷高，采用 Session 级去重机制
      const sessionKey = `viewed_p_${id}`;
      if (typeof window !== "undefined" && window.sessionStorage) {
        if (sessionStorage.getItem(sessionKey)) {
          return; // 本次会话内已统计过，不再重复累加
        }
        sessionStorage.setItem(sessionKey, "1");
      }
      await fetch(`/api/people/${id}/view`, { method: "POST" });
    } catch (e) {
      console.error("Failed to increment view", e);
    }
  };

  useEffect(() => {
    if (selectedPersonId) {
      incrementView(selectedPersonId);
      setConnectionPage(1); // Reset pagination when person changes
    }
  }, [selectedPersonId]);

  const fetchArchive = async () => {
    setIsLoadingArchive(true);
    try {
      const res = await fetch("/api/archive");
      if (!res.ok) {
        const errorText = await res.text();
        console.error("Archive fetch error:", errorText);
        setError(`无法获取馆藏数据: ${res.status} ${res.statusText}`);
        return;
      }
      
      const contentType = res.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
          const text = await res.text();
          console.error("Expected JSON but got:", text.slice(0, 200));
          throw new Error("服务器返回了非 JSON 格式的响应，可能是由于路由配置错误或服务器异常。");
      }

      const json = await res.json() as any;
      setData(json);
      if (json.people.length > 0 && selectedPersonId === null) {
        setSelectedPersonId(json.people[0].id);
      }
    } catch (err) {
      console.error(err);
      setError("网络连接错误，无法访问服务器。");
    } finally {
      setIsLoadingArchive(false);
    }
  };

  useEffect(() => {
    fetchArchive();
  }, []);

  const selectedPerson = data.people.find((p) => p.id === selectedPersonId);

  const connections = (() => {
    if (!selectedPerson) return [];

    // 1. Get from relationships table
    const tableConnections = data.relationships
      .filter(
        (r) =>
          r.person1_id === selectedPerson.id ||
          r.person2_id === selectedPerson.id,
      )
      .map((r) => {
        const otherId =
          r.person1_id === selectedPerson.id ? r.person2_id : r.person1_id;
        const otherPerson = data.people.find((p) => p.id === otherId);
        return {
          personName: otherPerson?.name || "未知",
          relationshipType: r.relationship_type,
          archivedPerson: otherPerson,
        };
      });

    // 2. Get from raw_relationships (might have un-archived people)
    let rawRels: { personName: string; relationshipType: string }[] = [];
    try {
      rawRels = selectedPerson.raw_relationships
        ? JSON.parse(selectedPerson.raw_relationships)
        : [];
    } catch (e) {}

    // Merge them, avoiding duplicates by name
    const merged = [...tableConnections];
    rawRels.forEach((rr) => {
      if (rr.personName && rr.personName !== "undefined" && !merged.some((m) => m.personName === rr.personName)) {
        const archived = data.people.find((p) => p.name === rr.personName);
        merged.push({
          personName: rr.personName,
          relationshipType: rr.relationshipType || "历史关联",
          archivedPerson: archived,
        });
      }
    });

    return merged;
  })();

  const topConnectedPeople = useMemo(() => {
    const counts = new Map<number, number>();
    data.relationships.forEach(r => {
      counts.set(r.person1_id, (counts.get(r.person1_id) || 0) + 1);
      counts.set(r.person2_id, (counts.get(r.person2_id) || 0) + 1);
    });
    
    return data.people
      .map(p => ({ id: p.id, name: p.name, count: counts.get(p.id) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [data.people, data.relationships]);

  const pageSize = 5;
  const totalPages = Math.ceil(connections.length / pageSize);
  const paginatedConnections = connections.slice(
    (connectionPage - 1) * pageSize,
    connectionPage * pageSize,
  );

  const handleLogout = () => {
    localStorage.removeItem("admin_password");
    setIsAuthorized(false);
    setIsAdminOpen(false);
    window.location.reload();
  };

  return (
    <div className="h-[100dvh] bg-slate-50 text-slate-800 font-sans flex flex-col overflow-hidden relative">
      {/* Background Image Setup */}
      <div
        className="absolute inset-0 z-0 opacity-[0.15] pointer-events-none"
        style={{
          backgroundImage:
            'url("https://images.unsplash.com/photo-1541963463532-d68292c34b19?q=80&w=2000&auto=format&fit=crop")',
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-br from-slate-50/80 via-slate-100/90 to-white/80 pointer-events-none" />

      {/* Header: Navigation & System Status */}
      <header className="h-[50px] sm:h-16 shrink-0 border-b border-slate-200/50 bg-white/60 backdrop-blur-xl z-[70] shadow-sm transition-all duration-500">
        <div className="max-w-[1800px] w-full mx-auto h-full px-3 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-4 sm:gap-8 min-w-0 flex-shrink-0">
            <div className="scale-110 sm:scale-150 origin-left flex shrink-0">
              <AnimatedLogo />
            </div>
            <div className="flex flex-col w-[80px] sm:w-[100px]">
              <h1 className="text-[17px] sm:text-xl font-bold text-slate-800 drop-shadow-sm leading-none sm:leading-tight flex justify-between">
                <span>名</span><span>人</span><span>图</span><span>谱</span>
              </h1>
              <p className="text-slate-400 font-bold text-[8.5px] sm:text-[10.5px] uppercase mt-0.5 sm:mt-1 flex justify-between">
                <span>时</span><span>空</span><span>关</span><span>系</span><span>探</span><span>索</span><span>平</span><span>台</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-6 text-sm flex-shrink-0">
            <div className="flex text-[10px] sm:text-sm px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-lg sm:rounded-xl border border-slate-200 text-indigo-600 font-medium bg-white/80 shadow-sm whitespace-nowrap items-center justify-center">
              收录：{data.people.length} 位
            </div>
            <button
               onClick={() => setIsFeedbackOpen(true)}
               className="p-1.5 sm:p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors border border-transparent hover:border-red-100"
               title="支持与反馈"
            >
               <Heart className="w-4 h-4 sm:w-5 sm:h-5 fill-red-400 text-red-500" />
            </button>
            <button
              onClick={() => setIsAdminOpen(true)}
              className="p-1.5 sm:p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors border border-transparent hover:border-indigo-100"
              title="后台管理"
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
            {isAuthorized && (
              <button
                onClick={handleLogout}
                className="p-1.5 sm:p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors border border-transparent hover:border-red-100"
                title="退出登录探索模式"
              >
                <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden max-w-[1800px] w-full mx-auto relative z-10 p-3 lg:p-6 pt-2 lg:pt-0 gap-3 lg:gap-6">
        {/* Left Column: List & Details */}
        <aside className="w-full lg:w-[450px] xl:w-[500px] h-auto lg:h-auto border border-slate-200/60 bg-white/70 backdrop-blur-2xl flex flex-col overflow-visible lg:overflow-hidden rounded-lg shadow-xl shadow-slate-200/50 flex-shrink-0">
          <div className="p-4 lg:p-6 pb-0">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 min-w-0 group">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="输入人名搜索..."
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-100/50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner group-hover:bg-slate-100/80"
                />
                <User className="w-4 h-4 absolute left-3.5 top-3 text-slate-400 pointer-events-none group-focus-within:text-indigo-500 transition-colors" />
              </div>
              <div className="relative flex-1 min-w-0 group">
                <select
                  value=""
                  onChange={(e) => {
                     const id = parseInt(e.target.value);
                     if (!isNaN(id)) {
                        setSelectedPersonId(id);
                        setDiscoveryPath(null);
                        setSearchQuery("");
                     }
                  }}
                  className="w-full pl-10 pr-10 py-2.5 bg-slate-100/50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all shadow-inner group-hover:bg-slate-100/80 appearance-none text-slate-600 font-medium"
                >
                  <option value="" disabled hidden>前10名连接最多...</option>
                  {topConnectedPeople.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.count} 联系)</option>
                  ))}
                </select>
                <Network className="w-4 h-4 absolute left-3.5 top-3 text-slate-400 pointer-events-none group-focus-within:text-indigo-500 transition-colors" />
                <div className="absolute right-3 top-3 pointer-events-none text-slate-400 group-hover:text-indigo-500 transition-colors">
                   <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 p-4 lg:p-6 pt-0 overflow-visible lg:overflow-y-auto">
            {error && (
              <div className="bg-red-50 text-red-600 p-3 lg:p-4 rounded-xl border border-red-100 text-sm mb-4 lg:mb-6 flex items-start gap-2 shadow-sm">
                <span className="font-bold">!</span> {error}
              </div>
            )}

            {searchQuery ? (
              <div className="flex flex-col min-h-0">
                <h2 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-4 flex items-center gap-2">
                  <Search className="w-4 h-4 text-slate-400" /> 搜索结果
                </h2>
                <div className="flex flex-col gap-1.5 overflow-visible lg:overflow-y-auto pr-2 pb-2">
                  {data.people
                    .filter((p) =>
                      p.name.toLowerCase().includes(searchQuery.toLowerCase()),
                    )
                    .slice(0, 10)
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPersonId(p.id);
                          setDiscoveryPath(null);
                          setSearchQuery("");
                        }}
                        className={`p-3.5 text-left w-full transition-all flex items-center justify-between rounded-xl group ${
                          p.id === selectedPersonId
                            ? "bg-indigo-50 border border-indigo-100 shadow-sm shadow-indigo-100 border-l-4 border-l-indigo-500"
                            : "hover:bg-slate-50/80 border border-transparent hover:border-slate-100"
                        }`}
                      >
                        <div
                          className={`text-sm font-bold ${p.id === selectedPersonId ? "text-indigo-900" : "text-slate-700 group-hover:text-slate-900"}`}
                        >
                          {p.name}
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            ) : selectedPerson ? (
              <div className="flex flex-col gap-8">
                <div className="flex items-start gap-6">
                  <button
                    onClick={() => setZoomedImage(selectedPerson.image_url)}
                    className="w-32 h-44 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl border border-slate-200/50 flex-shrink-0 relative overflow-hidden shadow-inner flex items-center justify-center group cursor-zoom-in"
                  >
                    {selectedPerson.image_url ? (
                      <img
                        src={selectedPerson.image_url}
                        alt={selectedPerson.name}
                        className="w-full h-full object-cover transition-transform group-hover:scale-110"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-800 uppercase tracking-tighter text-6xl font-black italic opacity-10 rotate-12 absolute scale-150">
                        {selectedPerson.name.slice(0, 2)}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent flex flex-col justify-end p-3 z-10 pointer-events-none">
                      <span className="text-[10px] text-white/90 font-mono tracking-wider font-semibold">
                        档案号: {String(selectedPerson.id).padStart(4, "0")}
                      </span>
                    </div>
                  </button>
                  <div className="flex-1">
                    <div className="text-xs uppercase tracking-widest text-indigo-500 font-bold mb-2">
                      {selectedPerson.category}
                    </div>
                    <h2 className="text-3xl font-serif font-bold text-slate-900 mb-4 leading-tight">
                      {selectedPerson.name}
                    </h2>
                    <div className="relative group/quote mb-3">
                      <div className="absolute -left-3 -top-2 text-indigo-200/60 text-4xl font-serif select-none pointer-events-none opacity-0 group-hover/quote:opacity-100 transition-opacity">
                        “
                      </div>
                      <div className="text-sm font-bold text-slate-500 tracking-wide border-l-2 border-indigo-400 pl-4 py-1 leading-relaxed bg-slate-50/50 rounded-r-lg">
                        <span className="text-indigo-500 font-serif mr-1">
                          “
                        </span>
                        {selectedPerson.keyword}
                        <span className="text-indigo-500 font-serif ml-1">
                          ”
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-start gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {selectedPerson.lifespan && (
                        <div className="inline-flex items-start gap-1.5 px-2 py-0.5 bg-slate-100 rounded-lg">
                          <span className="text-slate-400/80 shrink-0 whitespace-nowrap">生卒：</span>
                          <span className="text-slate-600">{selectedPerson.lifespan}</span>
                        </div>
                      )}
                      {selectedPerson.birthplace && (
                        <div className="inline-flex items-start gap-1.5 px-2 py-0.5 bg-slate-100 rounded-lg">
                          <span className="text-slate-400/80 shrink-0 whitespace-nowrap">籍贯：</span>
                          <span className="text-slate-600">{selectedPerson.birthplace}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-4 flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-slate-400" /> 人物小传
                  </h3>
                  <div className="text-slate-600 leading-relaxed text-base font-medium bg-indigo-50/30 p-5 rounded-2xl border border-indigo-100/50 shadow-inner space-y-5 text-justify">
                    {selectedPerson.biography?.split('\n').filter(p => p.trim()).map((para: string, idx: number) => (
                      <p key={idx}>{para}</p>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500 tracking-widest" />{" "}
                    主要成就
                  </h3>
                  <ul className="text-sm space-y-3 text-slate-600 font-medium italic">
                    {((): string[] => {
                      try {
                        return Array.isArray(selectedPerson.achievements)
                          ? selectedPerson.achievements
                          : JSON.parse(selectedPerson.achievements || "[]");
                      } catch (e) {
                        return [];
                      }
                    })().map((ach: string, i: number) => (
                      <li key={i} className="flex gap-3 leading-snug">
                        <span className="text-amber-500 shrink-0 mt-0.5 not-italic">
                          •
                        </span>{" "}
                        <span>{ach}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="text-xs uppercase tracking-widest text-slate-400 font-bold mb-3 flex items-center gap-2">
                    <Network className="w-4 h-4 text-slate-400" /> 时空关系网络
                  </h3>
                  <div className="flex flex-col gap-2.5">
                    {paginatedConnections.map((rel, i) => {
                      const archivedPerson = rel.archivedPerson;
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            if (archivedPerson) {
                              setSelectedPersonId(archivedPerson.id);
                              setDiscoveryPath(null);
                            }
                          }}
                          className={`group relative text-xs flex items-center justify-between p-3 rounded-2xl border transition-all duration-300 ${
                            archivedPerson
                              ? "bg-white border-slate-100 hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-50 cursor-pointer"
                              : "bg-slate-50/50 border-transparent cursor-default"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-xl overflow-hidden shadow-sm flex-shrink-0 flex items-center justify-center transition-all ${
                                archivedPerson
                                  ? "bg-indigo-50 ring-2 ring-white group-hover:ring-indigo-100"
                                  : "bg-slate-100"
                              }`}
                            >
                              {archivedPerson?.image_url ? (
                                <img
                                  src={archivedPerson.image_url}
                                  alt={rel.personName}
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ) : (
                                <User
                                  className={`w-5 h-5 ${archivedPerson ? "text-indigo-400" : "text-slate-300"}`}
                                />
                              )}
                            </div>

                            <div className="flex flex-col justify-center min-w-0">
                              <span
                                className={`text-sm font-bold truncate ${archivedPerson ? "text-slate-800" : "text-slate-400"}`}
                              >
                                {rel.personName}
                              </span>
                              <div className="text-[10px] text-slate-400 font-medium leading-relaxed mt-0.5 pr-2">
                                {rel.relationshipType}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center">
                            {archivedPerson ? (
                              <div className="text-indigo-400 group-hover:text-indigo-600 transition-all transform group-hover:translate-x-1">
                                <ChevronRight className="w-5 h-5" />
                              </div>
                            ) : (
                              <div className="text-slate-200">
                                <ChevronRight className="w-5 h-5" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {totalPages > 1 && (
                      <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-slate-100">
                        <button
                          onClick={() =>
                            setConnectionPage((prev) => Math.max(1, prev - 1))
                          }
                          disabled={connectionPage === 1}
                          className="flex-1 py-2 px-3 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-200 flex items-center justify-center gap-1"
                        >
                          <ChevronLeft className="w-3 h-3" />
                          上一页
                        </button>

                        <div className="flex items-center gap-1 px-3 py-1 bg-slate-100/50 rounded-lg">
                          <span className="text-[10px] font-black text-indigo-600">
                            {connectionPage}
                          </span>
                          <span className="text-[10px] font-medium text-slate-300">
                            /
                          </span>
                          <span className="text-[10px] font-medium text-slate-400">
                            {totalPages}
                          </span>
                        </div>

                        <button
                          onClick={() =>
                            setConnectionPage((prev) =>
                              Math.min(totalPages, prev + 1),
                            )
                          }
                          disabled={connectionPage === totalPages}
                          className="flex-1 py-2 px-3 bg-white hover:bg-slate-50 disabled:opacity-30 disabled:hover:bg-white text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-slate-200 flex items-center justify-center gap-1"
                        >
                          下一页
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    {connections.length === 0 && (
                      <div className="text-sm text-slate-400 italic mt-2">
                        暂无相关人物记录
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : isLoadingArchive ? (
              <div className="bg-white/40 border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center text-slate-500 flex flex-col items-center gap-4 m-auto">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-2">
                  <div className="w-6 h-6 border-4 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
                </div>
                <h3 className="text-lg font-bold text-slate-700">
                  档案库正在加载
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed max-w-[250px]">
                  正在从历史长河中打捞数据，请稍候...
                </p>
              </div>
            ) : data.people.length === 0 ? (
              <div className="bg-white/40 border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center text-slate-500 flex flex-col items-center gap-4 m-auto">
                <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-2">
                  <Zap className="w-8 h-8 text-indigo-400 animate-pulse" />
                </div>
                <h3 className="text-lg font-bold text-slate-700">
                  档案馆尚未开启
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed max-w-[280px]">
                  目前馆内空无一人。请利用右侧的 <span className="text-indigo-600 font-bold">时空关系网络探索</span> 输入两个历史人物，开启时空第一扇门，同步首批历史档案。
                </p>
              </div>
            ) : (
              <div className="bg-white/40 border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center text-slate-500 flex flex-col items-center gap-4 m-auto">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-2">
                  <BookOpen className="w-8 h-8 text-slate-400" />
                </div>
                <h3 className="text-lg font-bold text-slate-700">
                  尚未选择人物
                </h3>
                <p className="text-sm text-slate-500 leading-relaxed max-w-[250px]">
                  使用上方搜索框查找人物，或在右侧全景图谱中点击节点。系统将自动收录并建立关联。
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Right Column: Network Graph */}
        <section className="flex-1 flex flex-col bg-white/70 backdrop-blur-2xl border border-slate-200/60 rounded-lg shadow-xl shadow-slate-200/50 relative min-h-[60vh] lg:min-h-0 shrink-0 lg:shrink shadow-inner">
          <div className="p-3 bg-white/40 border-b border-slate-200/50 backdrop-blur-md z-20 flex justify-between items-start px-4 sm:px-6 relative rounded-t-lg">
            <h2 className="text-sm uppercase tracking-widest font-bold text-slate-400 flex items-center gap-2 mt-3">
              <Sparkles className="w-4 h-4" /> 全景图谱
            </h2>
            <div className="absolute left-4 right-4 sm:left-auto sm:right-6 top-2 z-30 flex justify-end origin-top-right">
              <div className="bg-white/95 backdrop-blur-md rounded-lg border border-slate-200/60 shadow-xl overflow-hidden flex flex-col max-h-[85dvh] sm:max-h-[calc(100dvh-120px)] w-full sm:w-[320px]">
                <SpacetimeExplorer
                  onClose={() => setIsSixDegreesOpen(false)}
                  onRefreshArchive={fetchArchive}
                  onSelectPerson={(id, name) => {
                    if (id > 0) {
                      setSelectedPersonId(id);
                    } else if (name) {
                      setPendingSelectName(name);
                    }
                  }}
                  onPathFound={(path) => {
                    setDiscoveryPath(path);
                    if (path && path.length > 0) {
                      setPendingSelectName(path[path.length - 1].name);
                    }
                  }}
                  isInline={true}
                  isAdmin={isAuthorized}
                  peopleNames={data.people.map((p) => p.name)}
                />
              </div>
            </div>
          </div>

          <div className="flex-1 relative min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar bg-white rounded-b-3xl">
            <div
              className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none"
              style={{
                backgroundImage:
                  'url("https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?q=80&w=2000&auto=format&fit=crop")',
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            <NetworkGraph
              people={data.people}
              relationships={data.relationships}
              selectedPersonId={selectedPersonId}
              onSelectPerson={(id) => {
                setSelectedPersonId(id);
                setDiscoveryPath(null);
              }}
              discoveryPath={discoveryPath}
            />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="shrink-0 border-t border-slate-100 py-1.5 px-6 bg-white/60 backdrop-blur-md relative z-10">
        <div className="max-w-3xl mx-auto flex flex-col items-center justify-center text-center gap-0.5">
          <div className="flex items-center gap-1.5">
            <div className="opacity-40 grayscale scale-75 origin-center flex shrink-0">
              <AnimatedLogo />
            </div>
            <p className="text-[11px] font-serif text-slate-700 italic font-medium">
              “世间万物，皆有联系。” —— 莱昂纳多·达·芬奇
            </p>
          </div>
          <div className="flex items-center gap-3 text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400/80 mt-0.5">
            <span>© 2024 AI时空关系探索平台</span>
            <span className="opacity-40">•</span>
            <span>
              AI 驱动的历史长河与关系脉络还原
            </span>
          </div>
        </div>
      </footer>

      <div className={isAdminOpen ? 'block absolute inset-0 z-[100] bg-white h-full overflow-hidden' : 'hidden'}>
        <AdminPanel
          onClose={() => {
            setIsAdminOpen(false);
            fetchArchive();
          }}
          onAuthorized={() => setIsAuthorized(true)}
          onPreviewPerson={(id, name) => {
            setIsAdminOpen(false);
            fetchArchive();
            if (id > 0) setSelectedPersonId(id);
            else if (name) setPendingSelectName(name);
          }}
        />
      </div>

      {/* Image Zoom Overlay */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-10 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-300"
          onClick={() => setZoomedImage(null)}
        >
          <button className="absolute top-8 right-8 text-white/50 hover:text-white transition-colors">
            <X className="w-10 h-10" />
          </button>
          <img
            src={zoomedImage}
            alt="Zoomed"
            className="max-w-full max-h-full rounded-2xl shadow-2xl animate-in zoom-in-95 duration-500"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
      {isFeedbackOpen && (
        <FeedbackModal onClose={() => setIsFeedbackOpen(false)} />
      )}
    </div>
  );
}
