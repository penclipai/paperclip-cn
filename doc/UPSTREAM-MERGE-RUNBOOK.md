# Penclip 上游同步与冲突处理 Runbook

## 1. 目的

这份文档说明后续从上游拉新代码时，如何在保留 Penclip 中文增强版能力的前提下，尽量低成本、低冲突地同步 `paperclipai/paperclip`。

目标不是“永远零冲突”，而是：

- 让冲突集中在少数已知文件和已知步骤里
- 避免误把 Penclip 的品牌、本地化、Windows 兼容层冲掉
- 尽量吸收上游结构、bugfix 和工程改进，而不是把旧 fork 文件整块留下

这是一份操作型 runbook。
规范性要求以仓库内其他文档为准。

## 2. 开始前先读什么

开始同步前，至少先读：

1. `AGENTS.md`
2. `doc/DEVELOPING.md`
3. `doc/UI-LOCALIZATION.md`
4. `doc/UPSTREAM-MERGE-RUNBOOK.md`

如果本次同步涉及 schema、shared contract、server 行为，额外再读：

1. `doc/SPEC-implementation.md`
2. `doc/DATABASE.md`

## 3. 先确认远端角色

不要先假设谁是 `origin`、谁是 `upstream`。
先看实际 remote 配置：

```sh
git remote -v
```

在 Penclip 场景里，通常会出现两类布局：

- 布局 A：
  - `origin` = 上游 `paperclipai/paperclip`
  - 私有/团队 fork 使用其他 remote 名称，例如 `private`
- 布局 B：
  - `origin` = Penclip 自己的仓库
  - `upstream` = `paperclipai/paperclip`

后面所有命令都要先映射清楚这三个角色：

- `upstream remote`
  - 原始 Paperclip 仓库
- `fork remote`
  - Penclip 自己的仓库
- `base branch`
  - Penclip 当前准备合并回去的目标分支，通常是 `master`

如果 remote 命名和本文示例不同，替换成你的实际名字，不要机械照抄。

## 4. Penclip 必须长期保留的 fork 差异

### 4.1 品牌与域名边界

用户可见层保留：

- `Penclip`
- `penclipai`
- `penclip.ing`
- `paperclipai.cn`

技术标识继续保留：

- `paperclip`
- `@paperclipai/*`
- `paperclipai` CLI
- `PAPERCLIP_*`

### 4.2 本地化基础设施

这些能力必须保留：

- `react-i18next` / `i18next` 根层接入
- `ui/src/i18n.ts`
- `ui/public/locales/zh-CN/common.json`
- `ui/public/locales/en/common.json`
- 默认 `zh-CN`
- 语言切换器
- `Accept-Language` / `Content-Language`
- 服务端用户可见错误的 locale 处理

### 4.3 Windows 兼容改造

这些改造不能在同步时被误回退：

- 用 Node 脚本替换 Unix-only shell 片段
- `dev/build` 链路中的 Windows 兼容处理
- `tsx` / dev watch 相关兼容修复

## 5. 推荐流程

### 5.1 确认工作区干净并拉最新 remote

开始前先确认没有临时改动：

```sh
git status --short
```

然后抓取所有相关 remote：

```sh
git fetch origin --prune
```

如果你有独立的上游或私有 fork remote，也一起抓：

```sh
git fetch upstream --prune
git fetch private --prune
```

### 5.2 创建工作分支和安全分支

推荐先从 Penclip 的目标基线拉一个工作分支，再额外留一个安全分支：

```sh
git checkout master
git pull --ff-only
git checkout -b codex/upstream-sync-YYYYMMDD
git branch codex/upstream-sync-YYYYMMDD-safety
```

这样即使后面冲突处理走偏，也能快速回到开始状态。

### 5.3 先和 Penclip 自己的目标分支对齐历史

如果你本地当前分支不是从 Penclip 最新 `master` 拉出来的，先和 Penclip 自己的目标分支对齐，再引入上游。

如果存在独立 `fork remote`，先看 `HEAD` 和 `fork/master` 的领先关系：

```sh
git rev-list --left-right --count private/master...HEAD
```

解释：

- 左边数字：只在 `private/master` 上的提交数
- 右边数字：只在 `HEAD` 上的提交数

如果左边不为 0，说明 Penclip 自己的目标分支比你当前分支更靠前，先合它：

```sh
git merge private/master
```

这样做的目的不是“制造额外改动”，而是先把 Penclip 自己的历史补齐，后面的上游同步会更容易判断。

### 5.4 先看范围，不要上来就 merge

在真正合并上游前，先看这次会影响哪些区域：

```sh
git log --oneline --decorate --stat HEAD..origin/master
git diff --name-only HEAD..origin/master
```

重点判断：

- 是否动到了 i18n 基础设施
- 是否动到了高 churn UI 页面
- 是否动到了 package manifest、workspace、exports 或 dev scripts
- 是否动到了 shared types / API contract / schema

### 5.5 用真实 merge commit 引入上游

Penclip 这种长期 fork，默认推荐 merge，不推荐把这类同步工作做成 rebase。

```sh
git merge origin/master
```

如果你的仓库布局是 `upstream/master` 才代表原始上游，就改成：

```sh
git merge upstream/master
```

为什么默认推荐 merge：

- 更容易保留“这是一轮上游同步”的上下文
- 更容易复盘冲突是怎么处理的
- 更适合长期 fork 持续同步

只有团队明确要求 rebase 时，再偏离这个默认流程。

## 6. 冲突处理原则

### 6.1 总原则

不要简单粗暴地：

- 全部选 `ours`
- 全部选 `theirs`
- 冲突一多就整文件重做

更稳的方式是：

1. 先保住上游结构
2. 再把 Penclip 差异按最小补丁接回去

### 6.2 优先吸收上游结构的文件

这些文件通常应该“以上游结构为主，手动补回 Penclip 差异”：

- 大多数页面组件
- 共享组件
- server route / service 逻辑
- package manifest
- 构建脚本

原因：

- 上游可能修了 bug
- 上游可能重构了组件结构
- 整文件保留旧 fork 版本，只会让下次更难合并

### 6.3 必须手动合并的文件

这些文件不要整文件选 `ours` 或 `theirs`，而是要手动合：

- `ui/public/locales/zh-CN/common.json`
- `ui/public/locales/en/common.json`
- `ui/src/i18n.ts`
- `ui/src/main.tsx`
- 语言切换器相关组件
- server locale 中间件和错误处理
- `README.md`
- `README.zh-CN.md`
- `doc/UI-LOCALIZATION.md`
- `doc/UPSTREAM-MERGE-RUNBOOK.md`

### 6.4 通常优先保留 Penclip 版本的文件

如果冲突集中在 Penclip 自己新增的文件，通常优先保留我们的版本，再手动吸收有价值的上游思路：

- `README.zh-CN.md`
- `doc/UI-LOCALIZATION.md`
- `doc/UPSTREAM-MERGE-RUNBOOK.md`

前提是上游没有新增同名文件或明确结构要求。

## 7. 审计顺序

参考流程里最值得保留的一点，是把“合并完成”拆成几类审计，而不是只盯冲突文件。

### 7.1 品牌与命名审计

检查这次 merge 影响到的文件，不只是有冲突的文件。

重点看：

- 用户可见 `Paperclip` 是否该改回 `Penclip`
- 技术标识是否被误改成 `penclip`
- `paperclipai` / `penclipai` / `paperclip.ing` / `penclip.ing` 是否落在正确边界

### 7.2 UI 本地化审计

对所有触及的 UI 页面和共享组件做一轮本地化复查，确认没有把高可见文案冲回英文：

- 标题
- 按钮
- 空状态
- 错误和 fallback
- 卡片副文案
- 表单提示
- tooltip / aria / toast

处理新页面时遵循 `doc/UI-LOCALIZATION.md`，不要重新发明一套词表。

### 7.3 locale JSON 审计

处理方式：

- 先保留上游新增 key
- 再补回 Penclip 已有翻译
- 不要删除英文 key
- 不要只改中文文件不改英文文件

检查重点：

- 有没有丢新增 key
- 有没有把中文值回退成英文
- 有没有把“智能体”等术语改回不一致状态

### 7.4 lockfile 审计

这一步要按本仓库当前规则执行，而不是照搬别的仓库习惯。

根据 `doc/DEVELOPING.md`：

- GitHub Actions 拥有 `pnpm-lock.yaml`
- 只有在 PR 修改了 package-manager 输入时，才应提交 `pnpm-lock.yaml`

所以本仓库当前默认策略是：

- 如果本次同步没有改 `package.json`、`pnpm-workspace.yaml`、`.npmrc` 或 `pnpmfile.*`，就不要带上 `pnpm-lock.yaml`
- 如果本次同步改了这些输入，并且干净环境里的 `pnpm install --frozen-lockfile` 需要 lockfile 才能通过，就必须提交最小 `pnpm-lock.yaml` diff
- 不要把“manifest 已变、lockfile 也该变”的情况，误当成单纯本地恢复步骤

检查命令：

```sh
git diff --name-only HEAD -- pnpm-lock.yaml
```

如果 lockfile 变了，先判断这次同步有没有 package-manager 输入变化。

没有输入变化时，恢复 lockfile：

```sh
git restore --staged --worktree pnpm-lock.yaml
```

有输入变化时，再做一次依赖解析校验：

```sh
pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile
pnpm install --frozen-lockfile
```

如果生成出的 lockfile 与工作区不一致，提交最小 `pnpm-lock.yaml` diff，而不是强行恢复。

### 7.5 干净环境验证

如果这次同步动到了依赖或 workspace 布线，不能只依赖当前机器的脏环境：

- `package.json`
- `pnpm-workspace.yaml`
- `.npmrc`
- package `exports`
- plugin / adapter / workspace manifest

这类改动建议在干净环境里复跑至少一遍：

```sh
pnpm install --frozen-lockfile
pnpm -r typecheck
```

Windows 上如果要做干净 Linux 验证，优先 Docker，不推荐默认走 WSL。

## 8. 高频术语回归清单

每次合并后，优先检查这些高频术语有没有被冲回去：

| 英文 | 正确中文 |
|---|---|
| Agent | 智能体 |
| Issue | 任务 |
| Routine | 例行任务 |
| Run | 运行 |
| Workspace | 工作区 |
| Costs | 成本 |
| Dashboard | 仪表盘 |
| Org | 组织 |

额外检查：

- `CEO` 不翻译
- `Onboarding` 不翻译
- 外部插件名不翻译

## 9. 推荐处理顺序

发生大量冲突时，按这个顺序处理最稳：

1. package / build / server 基础设施
2. shared types 和 API 合同
3. i18n 基础设施
4. locale JSON
5. 共享组件
6. 页面级改动
7. README 和文档

原因是前面的层一旦定下来，后面的页面冲突会更容易判断。

## 10. 合并后的验证步骤

### 10.1 质量门禁

按仓库要求，优先跑：

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
```

如果某项因为既有 Windows / 本机环境问题不能作为阻塞项，也要在提交说明里明确写清楚，不要含糊带过。

### 10.2 页面烟雾验证

至少打开这些页面：

- `/TES/dashboard`
- `/TES/onboarding`
- `/TES/costs`
- `/instance/settings/general`
- `/instance/settings/plugins`

优先确认：

- 默认语言仍然是中文
- 语言切换器仍可用
- 高可见导航仍是中文
- 没有明显把 `Agent` 冲回英文

### 10.3 Playwright 复验建议

如果这次同步改动到了 UI 高 churn 区域，建议用 Playwright 至少做一遍：

- dashboard
- onboarding
- issue detail
- costs
- plugin manager

## 11. 推荐提交策略

同步上游后，尽量拆成两类提交：

### 11.1 上游同步提交

只包含：

- 上游代码进入
- 必要冲突解决

### 11.2 Penclip 重新收口提交

只包含：

- 品牌修复
- 本地化修复
- Windows 兼容重新补齐

这样后续看历史时会清楚得多，也更容易回滚和复盘。

## 12. 常见错误

### 12.1 误把技术标识也改成 Penclip

错误示例：

- 改 package name
- 改 CLI 名
- 改环境变量名

正确做法：

- 只改用户能看到的品牌文案

### 12.2 为了保住中文，整文件保留旧版页面

后果：

- 错过上游 bugfix
- 下次更难合并

正确做法：

- 接收上游结构，重新补最小 i18n 补丁

### 12.3 只改中文 locale，不改英文 locale

后果：

- 英文模式缺 key
- fallback 行为异常

正确做法：

- 中英文一起改

### 12.4 把用户内容误当成漏翻

不要把这些算作需要修的翻译问题：

- 模型生成正文
- 评论正文
- 日志输出
- 外部插件名称
- 用户输入名称

### 12.5 把“看起来没变的历史对齐”省掉

后果：

- PR 历史不清楚
- 后续 triage 更难
- 同一类冲突反复出现

正确做法：

- 先看 `fork/master...HEAD`
- 需要时先合 Penclip 自己的目标分支

## 13. 快速操作模板

下面给的是“有独立私有 fork remote”的完整模板。
如果你的 remote 命名不同，替换成实际值：

```sh
git remote -v
git fetch origin --prune
git fetch private --prune
git checkout master
git pull --ff-only
git checkout -b codex/upstream-sync-YYYYMMDD
git branch codex/upstream-sync-YYYYMMDD-safety
git rev-list --left-right --count private/master...HEAD
git merge private/master
git log --oneline --decorate --stat HEAD..origin/master
git diff --name-only HEAD..origin/master
git merge origin/master
```

冲突处理后：

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
git restore --staged --worktree pnpm-lock.yaml
```

然后做页面烟雾验证，再提交。

## 14. 最后的判断标准

一次上游同步处理得是否正确，不看“冲突解决得有多快”，而看这四件事是否同时成立：

1. 上游结构和 bugfix 没丢
2. Penclip 的中文增强和品牌边界没丢
3. Windows 兼容层没被误回退
4. 下次再同步时，冲突没有因为这次处理方式而变得更糟

如果四者都成立，这次同步就是成功的。
