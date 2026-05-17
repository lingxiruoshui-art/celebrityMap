import React, { useState, useEffect } from "react";
import { X, Send, Heart, MessageSquare, ShieldAlert, Trash2, Ban } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface FeedbackModalProps {
  onClose: () => void;
}

interface Feedback {
  id: number;
  content: string;
  city: string;
  country: string;
  ip?: string;
  created_at: string;
}

export default function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [newFeedback, setNewFeedback] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const fetchFeedbacks = async () => {
    try {
      const res = await fetch("/api/feedback");
      if (res.ok) {
        const data = await res.json();
        setFeedbacks(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchFeedbacks();
  }, []);

  const maskIp = (ip?: string) => {
    if (!ip) return "未知";
    if (ip.includes(":")) {
      // IPv6 masking
      const parts = ip.split(":");
      return parts.slice(0, Math.min(parts.length, 3)).join(":") + ":****";
    }
    // IPv4 masking
    const parts = ip.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip;
  };

  const getLocationText = (f: Feedback) => {
    const city = (f.city && f.city !== 'Unknown' && f.city !== '未知') ? f.city : '';
    const country = (f.country && f.country !== 'Unknown' && f.country !== '未知') ? f.country : '';
    
    if (city && country) return `${city}, ${country}`;
    if (city || country) return city || country;
    return "未知地点";
  };

  const totalPages = Math.ceil(feedbacks.length / itemsPerPage);
  const currentFeedbacks = feedbacks.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFeedback.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newFeedback }),
      });

      if (res.ok) {
        setNewFeedback("");
        setSuccess(true);
        fetchFeedbacks();
        setCurrentPage(1); // Go back to first page on new submission
        setTimeout(() => setSuccess(false), 3000);
      } else {
        const d = await res.json() as any;
        setError(d.error || "提交失败");
      }
    } catch (e) {
      setError("网络错误");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveQR = () => {
    const link = document.createElement("a");
    link.href = "/payment.jpg";
    link.download = "wechat-pay-donation.jpg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-fit max-h-[90vh] md:h-[75vh] flex flex-col md:flex-row overflow-y-auto md:overflow-hidden relative"
      >
        {/* Left Side: Support/Donation */}
        <div className="w-full md:w-[35%] shrink-0 bg-slate-50 p-6 sm:p-8 border-b md:border-b-0 md:border-r border-slate-100 flex flex-col items-center text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-red-50 rounded-full flex items-center justify-center mb-4 md:mb-6 shrink-0">
            <Heart className="w-8 h-8 sm:w-10 sm:h-10 text-red-500 fill-red-500" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800 mb-2 md:mb-4 tracking-tight">支持我们的发展</h2>
          <p className="text-[11px] sm:text-[13px] text-slate-500 leading-relaxed mb-4 md:mb-6">
            感谢您使用 <span className="font-bold text-slate-800">名人图谱</span>。本站算力与存储均自费承担。打赏将全额用于抵扣成本，助力项目长存。愿您平安喜乐！
          </p>
          
          <div className="bg-white p-4 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 mb-4 md:mb-6 w-full max-w-[200px] md:max-w-[240px] shrink-0">
            <div className="aspect-square bg-slate-50 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden group">
               <img 
                 src="/payment.jpg" 
                 alt="WeChat Pay"
                 className="w-full h-full object-cover p-1 md:p-2"
               />
               <div className="absolute inset-x-0 bottom-0 bg-indigo-600 py-1.5 text-[10px] font-black text-white uppercase tracking-widest translate-y-full md:group-hover:translate-y-0 transition-transform">
                 微信扫码赞助
               </div>
            </div>
            <div className="mt-4 text-[10px] md:text-[11px] font-bold text-slate-400 tracking-tighter">微信扫码赞助</div>
          </div>

          <button 
            onClick={handleSaveQR}
            className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold text-sm hover:bg-slate-700 active:scale-[0.98] transition-all shadow-lg shadow-slate-200 shrink-0"
          >
            保存收款码为图片
          </button>
          
          <div className="mt-6 pt-2 text-[10px] font-medium text-slate-400 shrink-0">
            您的每一分心意，都是我们继续前行的动力
          </div>
        </div>

        {/* Right Side: Comments */}
        <div className="flex-1 flex flex-col p-6 sm:p-10 relative md:h-full md:min-h-0 overflow-visible md:overflow-hidden">
          <button 
            onClick={onClose}
            className="absolute right-4 top-4 md:right-6 md:top-6 p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all z-10"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 bg-indigo-50 rounded-2xl">
              <MessageSquare className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight">使用者评论反馈</h3>
              <p className="text-xs font-bold text-slate-400">每一条建议我们都会认真倾听</p>
            </div>
          </div>

          {/* Feedback List */}
          <div className="flex-1 md:overflow-y-auto my-6 pr-2 space-y-4 min-h-0">
            {feedbacks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-4 italic opacity-80">
                <p>暂无评论，留下您的第一条足迹吧</p>
              </div>
            ) : (
              <>
                {currentFeedbacks.map((f) => (
                  <div key={f.id} className="bg-slate-50/50 border border-slate-100 p-4 rounded-2xl">
                    <p className="text-sm text-slate-700 leading-relaxed mb-3">{f.content}</p>
                    <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      <span>
                        {maskIp(f.ip)} · {getLocationText(f)} · {(() => {
                          const dateStr = f.created_at;
                          if (!dateStr) return "-";
                          const utcDate = new Date(dateStr.replace(" ", "T") + "Z");
                          return utcDate.toLocaleString('zh-CN', { 
                            timeZone: 'Asia/Shanghai', 
                            year: 'numeric', 
                            month: '2-digit', 
                            day: '2-digit'
                          });
                        })()}
                      </span>
                    </div>
                  </div>
                ))}
                
                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-4 pt-2 pb-4">
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-all uppercase tracking-widest"
                    >
                      上一页
                    </button>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                      {currentPage} / {totalPages}
                    </span>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-500 hover:bg-slate-50 disabled:opacity-30 transition-all uppercase tracking-widest"
                    >
                      下一页
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Input Area */}
          <div className="pt-6 border-t border-slate-100 flex flex-col gap-3">
             <form onSubmit={handleSubmit} className="relative">
                <textarea 
                  value={newFeedback}
                  onChange={(e) => setNewFeedback(e.target.value)}
                  placeholder="说点什么吧... (在这里留下您的愿望或对本站的建议)"
                  className="w-full p-6 pr-16 bg-slate-50 border border-slate-200 rounded-3xl text-sm min-h-[120px] focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all resize-none shadow-inner"
                />
                <button 
                  type="submit"
                  disabled={isSubmitting || !newFeedback.trim()}
                  className="absolute right-4 bottom-4 p-3 bg-indigo-500 text-white rounded-2xl hover:bg-indigo-600 disabled:opacity-30 transition-all shadow-lg shadow-indigo-100"
                >
                  <Send className="w-5 h-5" />
                </button>
             </form>
             
             <div className="flex items-center justify-between px-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <div className="flex items-center gap-6">
                  <span>每人每天限2条</span>
                  <div className="h-3 w-[1px] bg-slate-200" />
                  <span className="text-red-400">恶意言论将被永久封禁 IP</span>
                </div>
                {success && <span className="text-emerald-500 animate-pulse">提交完成，感谢您的反馈！</span>}
                {error && <span className="text-red-500 animate-pulse">{error}</span>}
             </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
