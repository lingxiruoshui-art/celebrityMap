<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/309319c0-ccbb-434d-afc5-4fc77b62ee21

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

3.  **创建 KV 命名空间** (用于跨端同步时空探索状态)：
    *   进入 `Workers & Pages` -> `KV` -> `Create a namespace`。
    *   名称建议填：`explore_state_kv`。

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

3.  **KV namespace bindings**：
    *   Variable name: `EXPLORE_KV`
    *   KV namespace: 选择您刚才创建的 `explore_state_kv`。

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

### 5. AI Studio 预览环境测试

在 AI Studio 的实时预览环境中，程序会自动降级为本地 Node.js 模式：
*   **数据库**：自动回退使用 `better-sqlite3` 存储在根目录的 `celebrity_graph.sqlite`。
*   **图片**：由于未挂载 R2，回退到直接引用外部 URL 或 Pollinations AI 生成的地址。

