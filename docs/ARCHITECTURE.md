# 架构说明

## 请求路径

```text
浏览器
  -> aihero-zh Node 服务
      -> 本地页面快照 + 服务端注入维护元数据
      -> 本地静态资源缓存（可选）
      -> 未缓存资源请求 https://www.aihero.dev
      -> hydration 安全窗口后的本地中文词典与富文本块替换
```

服务默认发布固定快照，所以页面内容相对官方可以滞后；更新任务明确执行后才会变化。
这样用户请求不再等待官方 HTML、模型或翻译接口。代理仍不复制维护第二套 UI，CSS、图片和
Next.js 资源以快照抓取时的官方版本为准。

- `translation-runtime.js`：读取路径对应译文，先应用审核过的富文本块，再对其余可见文本节点做精确替换。
- `cfy-skills.user.js`：Skills 路由使用的社区 MIT 翻译脚本。
- `zh-overrides.css`：中文换行、字体 fallback 和移动端防溢出规则。

Next.js 的客户端路由会复用当前文档；如果直接放行，翻译运行时也会继续持有
上一条路径的词典和 Skills vendor 状态。因此覆盖层会在捕获阶段接管同站的跨路径
普通点击，改为完整页面导航，让代理为新路径重新注入上下文。页内锚点、组合键点击、
新标签页、下载链接和外站链接不受影响。官方域名的绝对内链也会映射回中文镜像。

## 译文数据

`content/translations/common.json` 保存跨页面公共文本，`home.json` 保存首页人工审校文本。
主代理审核批次位于 `content/translations/batches/`；`translation-rebuild-primary` 会确定性生成
`primary.json`。`build-translations` 只读取审核数据，不读取模型草稿 `memory.json`。

译文支持三种粒度：`exact` 为全局精确字符串，`routes` 为页面作用域片段，`blocks` 为保留链接的
整段富文本译文。富文本运行时只允许相对路径 `<a>` 以及 `em/strong/code/br`，其他标签和属性会被清理。

Skills 译文在 `vendor/cfy2015-aihero-skills-zh/`，来源和哈希由
`vendor/vendor-lock.json` 固定。更新 vendor 不会直接改变项目的审核状态；
维护者应该先查看 upstream diff，再更新锁文件。

## 原文快照与差异

`npm run sync-pages -- --all` 从官方 sitemap 抓取并锁定 HTML 与元数据到 `content/cache/`；
`npm run build-source` 从缓存提取标题、可见文本和哈希到 `content/source/`。
`npm run check-updates` 再次抓取并比较快照：

- `added`：新增文本，进入待翻译清单。
- `changed`：与旧文本高度相似的修改，旧译文标记为 stale。
- `removed`：上游删除的文本，保留记录方便审计。

报告位于 `reports/upstream-update.{json,md}`，维护状态页读取
`content/reports/latest.json`。
