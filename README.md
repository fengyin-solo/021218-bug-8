# PDF Viewer

基于 Vue 3 + Vite + PDF.js 构建的高精度 PDF 阅读器。

核心特性：
- PDF.js TextLayer 实现文字位置与原始 PDF 像素级对齐
- 选中 PDF 文字如同选中 HTML 文字一样自然准确
- 高 DPI 屏幕（Retina）清晰渲染
- 缩放、适合宽度、页码导航
- 文件选择和拖拽上传
- 滚动懒加载 + LRU 页面回收，大文件（200+ 页）不卡顿
- CMap 和标准字体支持，确保中文等复杂字体正确渲染

## 项目目录结构

```
├── docker-compose.yml          # Docker 编排配置
├── docs/
│   └── project_design.md       # 项目设计文档
├── frontend-user/              # Vue 3 前端项目
│   ├── Dockerfile              # 前端 Docker 构建文件
│   ├── nginx.conf              # Nginx 部署配置
│   ├── package.json            # 前端依赖与脚本
│   ├── vite.config.ts          # Vite 构建配置
│   ├── tsconfig.json           # TypeScript 配置
│   ├── index.html              # 入口 HTML
│   ├── public/                 # 静态资源
│   │   ├── pdfjs/              # PDF.js 库文件（含 cmaps、标准字体）
│   │   ├── sample.pdf          # 示例 PDF — 学术论文
│   │   ├── test.pdf            # 示例 PDF — 200 页压测
│   │   └── document.pdf        # 示例 PDF — 图文混排
│   └── src/
│       ├── App.vue             # 根组件
│       ├── main.ts             # 应用入口
│       ├── components/
│       │   └── PdfViewer.vue   # PDF 阅读器核心组件
│       ├── styles/
│       │   └── global.scss     # 全局样式
│       └── utils/
│           └── pdf-engine.ts   # PDF.js 引擎封装
└── README.md                   # 项目说明
```

## 快速启动

### 方式一：Docker（推荐）

```bash
docker-compose up --build -d
```

访问 http://localhost:8081

### 方式二：本地开发

```bash
cd frontend-user
npm install
npm run dev
```

访问 http://localhost:8081

## 子目录部署

构建产物使用相对路径（`vite.config.ts` 中 `base: './'`），可直接放到站点任意子目录，例如 `https://example.com/viewer/`，无需重新构建：

- PDF.js 脚本、worker、cmaps、标准字体及示例 PDF 的地址会在运行时**按当前部署目录自动取值**，不再写死站点根路径。
- 自动识别的部署位置会显示在工具栏 ⚙「资源设置」弹窗顶部；四项资源地址均支持单独覆盖（完整 URL、站点根绝对路径、相对部署目录路径均可），**保存后立即生效**，并按「来源 + 部署基路径」持久化在浏览器中，不同部署位置互不影响。
- 脚本地址取不到时，页面会给出明确失败说明和「重试加载」入口，不会一直停在加载中；设置面板的状态标记可区分**设置尚未生效**（待保存）与**地址本身取不到**（探活失败，含 HTTP 状态）。
- 修改资源地址不影响已经打开的文档（继续使用其加载时的 PDF.js 与地址）；「恢复默认」可清空全部覆盖。
- Nginx 子目录部署示例：

```nginx
location /viewer/ {
    alias /usr/share/nginx/html/;
    try_files $uri $uri/ /viewer/index.html;
}
```

## PDF 示例文件

将 PDF 文件放入 `frontend-user/public/` 目录，然后在页面中点击对应按钮加载：

| 文件 | 页数 | 内容说明 |
|------|------|----------|
| `sample.pdf` | 14 页 | Mozilla TracemonKey 学术论文，双栏布局、图表、公式、参考文献 |
| `test.pdf` | ~200 页 | 大文件压力测试，密集英文段落 + 数据行 |
| `document.pdf` | ~50 页 | 图文混排测试，色块、圆形、提示框、正文 |

也可在页面中选择本地 PDF 文件，或直接拖拽 PDF 文件到页面。

## 技术方案

PDF.js 三层渲染架构：
- Canvas Layer — 视觉渲染
- Text Layer — 透明文字选择层，像素级对齐
- Annotation Layer — 链接交互

性能优化：
- LRU 页面回收（最多 15 个已渲染页面）
- 逐页尺寸预计算，支持混合页面大小
- 渲染版本控制，缩放时取消过期任务
- rAF 滚动节流 + CSS GPU 加速

## 测试要点

1. 文字选择精度 — 选区与 Canvas 渲染文字位置精确对齐
2. 文字复制 — Ctrl+C 复制后粘贴内容正确
3. 大文件滚动 — 200 页快速滚动不卡顿，页码实时更新
4. 内存管理 — DOM 节点数稳定，离屏页面被回收
5. 缩放功能 — 缩放后文字选择仍然精确
6. 多字号渲染 — 8pt~28pt 各字号选择精度
7. 图文混排 — 图形区域不干扰文字选择
8. 文件加载 — 示例按钮、手动选择、拖拽上传

## 服务

| 服务 | 端口 | 说明 |
|------|------|------|
| frontend-user | 8081 | PDF Viewer 前端 |
