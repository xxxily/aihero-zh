# 翻译维护流程

## 1. 检查上游

```bash
npm run check-updates
```

先看 `reports/upstream-update.md`。这一步不会改写原文快照，也不会替换任何
已经审核的译文。

## 2. 更新原文快照

确认页面变化来自官方更新后运行：

```bash
npm run sync-pages -- --all
npm run build-source
```

变化后的英文原句进入 `content/reports/translation-queue.json`。审核译文应写入
`content/translations/batches/`，批次必须标记 `primary-agent-reviewed` 和
`reviewedBy: Codex`。普通文本放在 `exact`；只适用于单个页面的短片段放在 `routes`；
需要按中文语序重排且保留行内链接的段落放在 `blocks`。

首次发布译文必须由主代理逐条完成或审校，不能从本地模型草稿直接导入。

## 3. 更新 Skills 社区翻译

```bash
npm run vendor:update
```

该命令会抓取上游脚本、MIT 许可证、GitHub commit SHA 和内容哈希。若脚本发生
变化，应在 PR 中说明新增技能、译文范围和自检结果。

## 4. 审核检查

```bash
npm test
npm run translation-quality
npm start
```

浏览器中检查首页、`/skills`、任意 `skills-*` 详情页，并确认：

- 英文原句变化没有让旧中文静默失效。
- `/triage`、`npx skills@latest add` 等命令仍为原文。
- 手机端长标题、按钮和表格没有溢出。
- 登录、付费、订阅等动作仍明确回到官方站点。
# 翻译发布原则

翻译是离线构建步骤，不发生在用户请求路径中。一次发布对应一个明确的上游快照和一份
模型配置/版本记录；用户访问只读取仓库内已生成的中文页面词典。

推荐更新顺序：

1. `npm run check-updates` 检查 sitemap 中上游文本变化。
2. `npm run sync-pages -- --all` 抓取新的页面快照到 `content/cache/`。
3. `npm run build-source` 从快照重建 `content/source/`。
4. 主代理把审核译文写入 `content/translations/batches/`。
5. `npm run translation-rebuild-primary` 从所有审核批次确定性重建 `primary.json`。
6. `npm run build-translations` 生成按路由拆分的发布词典。
7. 运行 `translation-quality`、单元测试和浏览器回归后再发布。

`npm run update` 默认绝不调用模型。后续增量更新若确实需要模型，必须同时提供
`--translate` 和 `--translate-config=<file>`，且配置中的 `enabled` 必须为 `true`。
任务按原文字符串去重，草稿写入 `content/translations/memory.json`；中断后可继续。
这个草稿文件被 gitignore，发布构建也不会读取它。

模型提示词要求保留命令、路径、代码、URL、品牌名和产品术语。任何模型结果都只是草稿，
必须经过主代理或人工复核、整理成审核批次并重建 `primary.json`，才会进入发布构建。
