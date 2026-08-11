# AI Hero 中文社区版

这是 [aihero.dev](https://www.aihero.dev/) 的非官方中文社区镜像，目标不是做一次性页面翻译，而是保留原站布局与交互，并建立可重复执行的快照同步、差异检测、人工审校和增量更新流程。

项目仓库：<https://github.com/xxxily/aihero-zh>

> 本项目与 AI Hero、Matt Pocock 没有官方从属关系。页面结构和英文原文归原作者所有，中文译文及维护代码按仓库许可证发布。

## 当前状态

- 已保存 199 个公开页面快照。
- 首版中文内容已经过人工审校，严格翻译门禁为 `0` 个问题、`0` 条待翻译。
- 首屏 HTML 在服务端直接输出中文；客户端运行时只负责处理 hydration 后新增或被 React 恢复的动态文本。
- 侧栏被省略的长标题会在悬浮时显示完整中文，不再叠加英文副本。
- 页面切换带顶部进度条，并在目标页中文渲染完成后结束。
- 后续模型翻译默认关闭，只能通过显式配置用于增量更新草稿；草稿不会自动进入发布词典。

## 工作方式

```text
官方页面
   │
   ├─ sync-pages：保存固定 HTML 快照和元数据
   ├─ build-source：提取可审校原文及文本指纹
   ├─ check-updates：比较新增、删除和变化内容
   └─ translations：加载人工审校的公共、首页、页面和富文本词典
           │
           ▼
Node 镜像服务
   ├─ 输出服务端中文 HTML
   ├─ 转发并缓存 Next.js 静态资源
   ├─ 提供动态翻译词典接口
   └─ 客户端运行时处理 hydration、动态 Tooltip 和页面切换
```

设计原则：

1. 官方站点是页面结构和样式的来源，不在本仓库复制维护另一套 UI。
2. 中文内容独立版本化，按原文、页面路径和文本指纹跟踪变化。
3. 首次全量译文由 Codex 直接审校完成，不使用本地或第三方翻译模型。
4. 后续同步允许保留一定滞后性，只有执行维护脚本时才更新固定快照。
5. 登录、付款、订阅和账户等操作仍依赖官方服务，不在社区镜像中保存用户数据。

## 环境要求

- Node.js 20 或更高版本，推荐 Node.js 22。
- npm。
- 同步上游页面时需要访问 `https://www.aihero.dev`。

## 本地运行

仓库已经包含页面快照和发布词典，普通运行不需要先同步上游：

```bash
npm ci
npm start
```

默认地址：<http://127.0.0.1:4173>

维护状态页：<http://127.0.0.1:4173/__aihero/status>

使用其他端口：

```bash
AIHERO_ZH_PORT=4174 npm start
```

修改运行配置时可复制示例文件：

```bash
cp .env.example .env
```

Node 本身不会自动读取 `.env`；可以由部署平台注入变量，或使用它支持的环境文件机制。

## 验证

```bash
# 严格翻译质量检查和全部自动化测试
npm run verify

# 也可以分别执行
npm run translation-quality:strict
npm test
```

严格模式会检查缺失译文、保留术语、命令和代码片段等规则。任何待翻译内容都会使命令失败。

## 同步与更新

### 检查上游变化

```bash
npm run check-updates
```

差异报告会写入 `reports/upstream-update.*`。GitHub Actions 也会每周执行一次检查并上传报告产物。

### 更新单个页面

```bash
npm run sync-pages -- --route=/
npm run build-source
npm run translation-quality:strict
npm test
```

把 `/` 换成需要更新的路径即可。这适合修复单个页面快照和上游构建不匹配的问题。

### 更新全部页面

```bash
npm run sync-pages -- --all
npm run build-source
npm run check-updates
```

更新快照后，如果报告出现待翻译内容，应由维护者审校译文，再执行：

```bash
npm run translation-rebuild-primary
npm run build-translations
npm run verify
```

### 一体化更新

```bash
# 检查、同步固定快照、重建词典、质量检查和测试；默认不调用模型
npm run update

# 只检查，不修改固定页面版本
npm run update -- --check-only
```

### 后续增量模型配置

模型功能默认关闭。只有后续上游更新时，维护者才可以显式启用兼容 OpenAI API 的强模型：

```bash
npm run update -- --translate \
  --translate-config=config/translation.openai-compatible.json
```

模型输出只进入被 `.gitignore` 排除的草稿记忆文件，不会直接发布。审核后的条目必须整理为 `primary-agent-reviewed` 批次，再确定性重建 `primary.json`：

```bash
npm run translation-import -- \
  --batch=content/translations/batches/NNN-name.json
npm run translation-rebuild-primary
npm run build-translations
npm run verify
```

## `Application error` 排查

固定 HTML 快照中包含对应版本的 Next.js 客户端模块和 Server Action 标识。如果官方站点完成了一次新部署，而本地仍使用旧快照，旧页面在 hydration 后调用当前上游 Server Action 时可能收到 `404`，浏览器随后显示：

```text
Application error: a client-side exception has occurred
```

这不代表中文词典损坏。先同步发生问题的页面：

```bash
npm run sync-pages -- --route=/发生问题的路径
npm run build-source
npm run verify
```

例如首页：

```bash
npm run sync-pages -- --route=/
npm run build-source
npm run verify
```

同步后如果产生新英文内容，严格翻译门禁会列出缺失项；完成审校后再提交更新。

## 部署

### 推荐：长期运行的 Node.js 服务

当前项目最适合部署到 VPS、Railway、Render、Fly.io 或其他能够长期运行 Node.js 进程的平台。

构建命令：

```bash
npm ci
```

启动命令：

```bash
npm start
```

建议环境变量：

```env
AIHERO_ZH_HOST=0.0.0.0
# 大部分平台会自动注入 PORT；程序同时兼容 PORT 和 AIHERO_ZH_PORT
AIHERO_PAGE_MODE=snapshot
AIHERO_ALLOW_ORIGIN_POST=1
AIHERO_ORIGIN=https://www.aihero.dev
```

部署时必须保留仓库中的 `content/cache/html`、`content/cache/meta`、`content/source` 和 `content/translations`。`content/cache/assets` 不进入 Git，可由运行中的服务按需重新缓存。

### GitHub Pages：当前不能直接部署

GitHub Pages 只能托管静态文件，而本项目当前需要：

- Node.js HTTP 服务；
- `/__aihero/translations` 等运行时接口；
- Next.js 静态资源与图片请求转发；
- 部分官方 Server Action 和公共 POST 请求；
- 针对每个页面动态注入中文 HTML 和导航运行时。

因此，把仓库直接发布到 GitHub Pages 会出现路由 404、资源路径错误、动态翻译接口缺失和表单/交互失效。

如果未来要支持 GitHub Pages，需要新增独立的静态导出流程：

1. 把每个页面生成成对应目录的 `index.html`；
2. 将路由词典完全烘焙进 HTML，移除运行时词典接口；
3. 下载并重写全部 Next.js、字体、图片及 `_next/image` 资源；
4. 移除或改写 Server Action、登录、订阅和账户请求；
5. 支持仓库子路径 `/aihero-zh/` 的 `basePath`；
6. 生成 GitHub Pages 所需的 `404.html` 和部署工作流；
7. 对全部页面重新进行视觉与链接验证。

在完成这些改造前，不建议开启 GitHub Pages。若只希望使用自定义域名，建议将域名解析到 Node 部署平台，而不是 GitHub Pages。

## 主要目录

```text
content/cache/html/          固定官方 HTML 快照
content/cache/meta/          快照来源、时间和上游元数据
content/source/              从快照提取的原文与文本指纹
content/translations/        公共、首页、页面和审核批次译文
public/                      翻译、导航与中文样式运行时
scripts/                     同步、差异、构建、翻译和质量脚本
src/                         Node 镜像服务及 HTML 处理逻辑
test/                        自动化回归测试
docs/                        架构和翻译维护文档
```

进一步阅读：

- [架构说明](docs/ARCHITECTURE.md)
- [翻译维护流程](docs/TRANSLATION_WORKFLOW.md)

## 许可证与声明

请阅读 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。社区镜像应尊重官方内容、品牌及第三方资源的原始许可；公开部署前请自行确认内容镜像和资源分发的合规要求。
