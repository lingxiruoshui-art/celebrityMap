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

### 4. 自动初始化

完成绑定并重新发布后，**程序在首次访问任何 API 接口时，会自动检测并创建 D1 数据库中的表结构**。你无需手动上传任何 `.sql` 文件。

### 5. AI Studio 测试

在 AI Studio 中，程序会自动降级为本地 Node.js 模式：
*   **数据库**：自动存储在根目录的 `celebrity_graph.sqlite`。
*   **图片**：直接引用外部 URL 或 Pollinations AI 生成的地址。
