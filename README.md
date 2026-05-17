<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/309319c0-ccbb-434d-afc5-4fc77b62ee21

## 项目架构与文件用途

### 1. 系统整体架构
本系统采用 **前后端分离** 的全栈架构，并具备 **同构适配** 能力，可无缝运行于本地 Node.js 环境或 Cloudflare Pages/Workers 云端环境。

*   **前端 (Frontend)**: 基于 **React 18 + Vite** 开发。使用 Tailwind CSS 进行响应式布局，Lucide React 提供图标支持。
*   **后端 (Backend)**: 核心 API 逻辑采用 **Hono** 框架编写，运行在 `server.ts` (Node 适配层) 或 `src/cloudflare.ts` (Cloudflare 适配层) 之上。
*   **数据库 (Database)**: 采用 **SQLite + D1** 同构方案。开发环境使用本地 `.sqlite` 文件，生产环境对接 Cloudflare D1 分布式数据库。
*   **存储 (Storage)**: 图片资产支持本地 URL 代理与 **Cloudflare R2** 镜像转存机制。
*   **AI 层 (Intelligence)**: 深度集成 **Google Gemini 1.5/2.0** 系列模型，负责历史人物的自动发现、百科生成以及时空连接深度分析。

### 2. 关键文件用途说明

#### 核心配置与入口
*   `server.ts`: Node.js 开发环境入口。初始化 Express 容器，挂载 Hono API 路由和 Vite 中间件（用于预览联调）。
*   `wrangler.toml`: Cloudflare 部署配置文件，定义了 D1, R2 等资源的绑定关系。
*   `schema.sql`: 数据库初始化脚本，定义了 `people` (人物), `connections` (关联), `logs` (任务日志) 等核心表结构。
*   `package.json`: 定义工程全量依赖及构建脚本。

#### 后端逻辑 (`src/`)
*   `app.ts`: **系统逻辑核心**。包含所有 API 接口逻辑（人物数据管理、AI 自动探索、关系推演算法、R2 图片动态镜像代理等）。
*   `db.ts`: 数据库驱动适配层。通过 `DatabaseAdapter` 接口统一了 D1 (生产环境) 和 better-sqlite3 (开发环境) 的操作 API。
*   `exploreStep.ts`: 封装了 AI 探索单步任务的原子逻辑，控制 Gemini 进行人物抓取、属性分析和时空关系建立。
*   `figuresPool.ts`: 预设的人物种子库和分类种子定义，引导 AI 初始阶段的探索发散方向。

#### 前端 UI (`src/`)
*   `App.tsx`: 前端主程序入口。负责时空关系网的可视化展示（基于 Canvas/SVG 仿真）、搜索过滤及核心用户交互。
*   `components/AdminPanel.tsx`: **功能强大的管理后台组件**。提供数据库即时维护、AI 任务实时监控、模型配置切换及全文搜索等管理功能。
*   `index.css`: 全局样式定义，基于 Tailwind CSS 4.0 配置。

### 3. 代码规模统计
目前项目核心代码总量约为 **4,000+ 行** (不含生成的依赖和构建产物)。

| 文件/目录 | 主要语言 | 功能描述 | 约占行数 |
| :--- | :--- | :--- | :--- |
| `src/app.ts` | TypeScript | 后端核心 API & AI 逻辑 | ~1,670 |
| `src/components/AdminPanel.tsx` | TypeScript (React) | 管理后台 UI & 数据交互逻辑 | ~1,130 |
| `src/App.tsx` | TypeScript (React) | 前端主界面 & 关系图谱交互 | ~690 |
| `server.ts` | TypeScript | Node.js 兼容层 & 端点集成 | ~140 |
| `src/exploreStep.ts` | TypeScript | AI 探索策略与任务执行 | ~80 |
| 其他辅助脚本/配置 | TS/JS/SQL | 数据库驱动、类型定义、SQL 指令等 | ~300 |

## Run Locally

**Prerequisites:**  Node.js


## Cloudflare 部署指南 (Git 模式)

本程序已针对 Cloudflare 生态（Pages + D1 + R2）进行深度适配。得益于内置的 `seedDatabase` 逻辑，**你不需要手动运行 SQL 初始化脚本**，程序在首次访问 API 时会自动创建所需的表结构。

### 1. 创建 Cloudflare 资源

在 Cloudflare 控制台手动完成以下操作：

1.  **创建 D1 数据库**：
    *   进入 `Workers & Pages` -> `D1` -> `Create database`。
    *   名称建议填：`celebrity_graph`。
    *   **记得记录下 `Database ID`**。

2.  **创建 R2 存储桶**：
    *   进入 `R2` -> `Create bucket`。
    *   名称建议填：`historical-portraits`。

### 2. 在 Cloudflare Pages 中进行 Git 关联

1.  将代码推送到你的 GitHub 仓库。
2.  在 Cloudflare Pages 中点击 `Connect to git`。
3.  **构建设置**：
    *   Framework preset: `None` (或者选择 `Vite`)
    *   Build command: `npm run build`
    *   Build output directory: `dist`

### 3. 配置绑定 (关键步骤)

在 Pages 项目的 **Settings -> Functions -> Compatibility flags** 中，确保 `Compatibility date` 设置为较新的日期（如 `2024-01-01`）。

在 **Settings -> Functions -> Tool bindings** 处：

1.  **D1 database bindings**：
    *   Variable name: `DB`
    *   D1 database: 选择你刚才创建的 `celebrity_graph`。

2.  **R2 bucket bindings**：
    *   Variable name: `IMAGES`
    *   R2 bucket: 选择你刚才创建的 `historical-portraits`。

在 **Settings -> Environment variables** 处添加：
*   `ADMIN_PASSWORD`: 管理员后台密码（选填，默认 admin）。
*   `GEMINI_API_KEY`: Google Gemini API 密钥（选填，也可以在进入后台后动态配置）。

### 4. 自动初始化与深度适配

完成绑定并重新发布后，**程序在首次访问任何 API 接口时，会自动检测并创建 D1 数据库中的表结构**。你无需手动上传任何 `.sql` 文件。

此外，本代码已针对 Cloudflare Worker / Pages 的限制进行了以下专门适配：
*   **完美兼容 SPA 路由**：前端是基于 React 状态流的纯单页面架构，无需配置 Cloudflare 的 `_routes.json` 或 `_redirects` 规则。
*   **R2 图片内联代理**：当你绑定了 R2 `IMAGES` 时，程序会自动通过内部路由 `/api/portraits/*` 加载图片并添加长效缓存 (Cache-Control)，无需配置自定义域名即可实现秒开，节省费用。
*   **自动镜像转存**：已添加后台自动镜像功能，每次加载图谱数据时，如果检测到历史遗留的人物图片仍然使用外部 URL（或 Pollinations.ai 链接），系统将在请求后台中自动抓取图片存入 R2，并将记录无缝更新为 `/api/portraits/*` 本地路由，整个过程静默完成，后续不再重复请求外部网络。
*   **同构数据库**：利用 Hono + Database Adapter 模式，使得在 Cloudflare 环境中完美对接原生 D1 API，在 Node 本地环境中无缝切换为 sqlite。

### 5. Pages 与 Worker 的详细交互与路由机制

本项目采用了 Cloudflare **Pages + Functions (Worker)** 的混合形态进行全栈部署，实现了“静态资源 CDN 托管”与“边缘无服务器计算”的完美解耦，具体交互与生命周期如下：

#### 5.1 本地开发与联调阶段 (Vite + Express/Node.js)
1. 在本地环境中，通过 `npm run dev` 启动的开发服务器，实际上是由 `server.ts` 提供支持。
2. `server.ts` 会挂载 **Vite 开发者中间件** 用于提供 React 前端文件的热更新和渲染。
3. 所有前缀为 `/api/*` 的网络请求会被 `server.ts` 内部的路由规则拦截，并直接转交给 `src/app.ts` 中的 Hono 实例处理。
4. Hono 实例此时会使用 `better-sqlite3` 驱动本地的 `.sqlite` 文件模拟边缘数据库。

#### 5.2 生产环境部署层 (Pages + Functions)
Cloudflare Pages 在托管静态文件时，提供了 `Functions` 机制，其底层依然是 Cloudflare Workers，但具有基于文件系统的自动化路由引擎。

1. **静态资源分发 (Pages)**：执行 `npm run build` 后，所有的 React/TS 源码、Tailwind CSS 均被编译成静态产物并存放在 `/dist` 目录。这些内容会被完整上传到 Cloudflare Pages 的全球 CDN 网络中，实现极速的首屏静态加载。
2. **边缘无服务器拦截 (Functions)**：我们在项目中设置了特殊的约定式路由文件即 `functions/api/[[route]].ts`（Advanced Mode 聚合路由形式）。
   * 这使得 Cloudflare 会自动创建一个内部的 Worker 进程，用于监听发往当前域名的任意 `/api/*` 请求。
   * **请求阻截**：在前端页面中发起的 `fetch('/api/people')` 请求，不会去寻找不存在的静态文件，而是被直接路由进入这个后台 Worker。
3. **同构 Hono 实例执行**：在 `[[route]].ts` 中，我们动态引出了 `src/app.ts` (基于 Hono 框架)。此时，Hono 收到了 Cloudflare 传递的 HTTP 请求和边缘上下文（包括 `env.DB` 和 `env.IMAGES` 绑定）。
4. **数据库与流式响应 (D1/R2)**：Hono 判断路由、执行业务逻辑，调取 D1 数据库和 R2 存储引擎，将结构化数据以 `application/json` 或图片流形工返回给前端 Pages。

这种架构做到了真正的零运维和自动伸缩：前端流量再大也能被全球 CDN 拦截吸收，而后端 API 触发则以无服务器微函数（Serverless Component）进行按需计费的即时计算。

#### 5.3 Functions (Worker) 目录文件详细解读

Cloudflare Pages 在后台利用 Functions 来实现无服务器计算特性。本项目中 `functions/` 目录里的文件承担了关键的桥接和定时任务调度作用，具体文件体系如下：

*   **`functions/api/[[route]].ts`**
    *   **作用**：基于 Cloudflare Pages 的高级路由聚合模型（Advanced Routing Mode），构建的“通配符拦截入口”。
    *   **原理解析**：当用户向 `/api/...` 发起任意深度的路径请求时，若不存在对应静态文件，Pages 就将请求转交该脚本。
    *   **工作流**：它通过 `import { handle } from "hono/cloudflare-pages"` 将跨平台同构的 `src/app.ts` Hono 实例转变为 Edge Worker 函数格式。
    *   **设计优势**：业务逻辑被彻底剥离在了标准的 `src/app.ts` 代码中进行编写并测试，此文件仅扮演低频更新的“适配器/网关”，实现了边缘 Worker 与 Hono 的解耦。

*   **`functions/_scheduled.ts`**
    *   **作用**：Cloudflare Workers 原生的全局事件触发器入口，用作 Cron Jobs 定时任务中心引擎。
    *   **原理解析**：依托 Cloudflare 的后台所下发的 Cron Triggers （在面板中设置调度频率），能够在指定时间激活此边缘计算程序。
    *   **工作流**：每当调度周期触达（如每 5 分钟、每天凌晨等），边缘网络会唤醒此脚本并传入 `ScheduledController` 对象。该脚本构造了一个带有系统内部鉴权标头 (`x-admin-password`) 和 Secret 参数的内部标准 HTTP Request（指向 `/api/cron` 端点），直接投递给 `src/app.ts` 的 Hono `app.fetch`进行事件执行并消费返回结果，开启时空补位与处理流水线。
    *   **设计优势**：巧妙兼容基于标准 HTTP API 请求触发的系统核心架构。避免了拆分代码写出专门的定时执行函数逻辑，重用原本暴露的 `/api/cron` 常规接口；同时它会在发起任务后挂起（await response），保障了边缘环境在无响应返回时不会杀掉 V8 线程。

#### 5.4 独立后台计算集群 (worker/cron.js) 与 Pages 的交互逻辑

为了解决 LLM 接口生成长文本/长链推理常常超出普通 Serverless 边缘应用执行时长（如 Pages 的 30s 请求超时上限），我们在 `worker/` 目录下部署了独立的纯血版 Cloudflare Worker 实例，并借助 Cloudflare **Queue (消息队列)** 建立了一套高可用的异步事件微服务，彻底解决了连接超时问题。

1. **分布式触发调度 (Scheduled 阶段)**：
   * `cron.js` 的 `scheduled` 方法由 Cloudflare 控制台定义的 Cron Trigger (如 `*/5 * * * *`) 触发运行。
   * 唤醒后，它会携带高安全 `CRON_SECRET` 主动向主域名的 `GET /api/internal/next-task` 接口发起短连接请求。
   * Pages 服务端 (Hono) 检索 SQLite (`explore_queue` 表)，并将优先级最高、等待最久的任务（以及当前的 AI 密钥和模型配置）返回给 Worker。如果开启了自动补位，Pages 还会在此刻自行生产新的随机图谱探索目标入库。
   * Worker 收到待处理任务后，立刻将其序列化并投入绑定好的 Cloudflare Queue (`EXPLORE_QUEUE`) 中，至此短连接结束，Pages 无需再阻塞等待 AI 的响应。

2. **异步队列消费引擎 (Queue Consumer 后台计算)**：
   * Cloudflare 基础设施探测到 `EXPLORE_QUEUE` 中有新消息，分配闲置后端的 Node/V8 引擎资源，触发 `cron.js` 的 `queue` 函数进行消费。消息队列的独有特性允许脚本在此阶段存活非常久（长达 15 分钟），足以应对多轮 AI 请求或网络波动。
   * **运行期状态回写**：Queue 引擎生成唯一的 Trace ID。在请求 Wikipedia 构建基础身份，以及向 Gemini 或阿里云请求生成 JSON 拓扑结构的漫长过程中，它会不断通过 `POST /api/internal/log`（写入单节点时序日志记录）和 `POST /api/internal/state`（更新全局轮询状态）与 Pages 实时通讯。因此管理员即便是看着前端大屏，也能如丝般顺滑地看到后端隔离任务的各项推进日志。
   * **灾备降级与智能解析**：在获取高维 AI 响应用时，具备失败自动重试机制与正则断言修复能力，以抵抗大模型胡言乱语导致 JSON 解析崩溃。
   * **最终全息镜像封装并汇交 (Submit Phase)**：AI 整理出的人物生平、核心事件及关联图谱结构数据。由 Queue 引擎打包发出最后一击 `POST /api/internal/submit`。
   
3. **闭环收拢与图谱入库 (Pages 端最终处理)**：
   * Pages 端的 Hono 服务收到从 Worker 发回的完美构造数据，立刻将其连入整个 SQLite (`celebrities`) 以及拉拔边网络。
   * **图片静默转写**：同时，Pages 控制台调用绑定的 Cloudflare R2，通过 `wikiMeta` 收录的高清原图 URL 拉取数据流并持久化至对象存储（形成 `/api/portraits` 缓存）。使得下一次用户打开该知识节点时直接命中本地边缘缓存，全链路闭环，没有任何延迟黑洞。

### 6. AI Studio 预览环境测试

在 AI Studio 的实时预览环境中，程序会自动降级为本地 Node.js 模式：
*   **数据库**：自动回退使用 `better-sqlite3` 存储在根目录的 `celebrity_graph.sqlite`。
*   **图片**：由于未挂载 R2，回退到直接引用外部 URL 或 Pollinations AI 生成的地址。

