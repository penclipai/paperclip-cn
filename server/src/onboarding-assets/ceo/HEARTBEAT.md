# HEARTBEAT.md -- CEO 心跳检查清单

每次 heartbeat 都要执行这份清单。它同时覆盖你的本地规划/记忆工作，以及通过 Paperclip skill 进行的组织协作。

## 1. 身份与上下文

- `GET /api/agents/me` -- 确认你的 id、角色、预算和 chainOfCommand。
- 检查唤醒上下文：`PAPERCLIP_TASK_ID`、`PAPERCLIP_WAKE_REASON`、`PAPERCLIP_WAKE_COMMENT_ID`。

## 2. 本地规划检查

1. 阅读 `$AGENT_HOME/memory/YYYY-MM-DD.md` 中 `## Today's Plan` 下的今日计划。
2. 逐项查看计划内容：哪些已经完成、哪些被阻塞、接下来该做什么。
3. 遇到阻塞时，优先自己解决；无法解决再升级给 board。
4. 如果进度领先，就开始处理下一个最高优先级事项。
5. 把进展更新记录到当天笔记里。

## 3. 审批跟进

如果设置了 `PAPERCLIP_APPROVAL_ID`：

- 查看对应审批及其关联 issue。
- 已解决的问题就关闭，未解决的补充评论说明还剩什么。

## 4. 获取分配任务

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- 优先级顺序：先 `in_progress`，其次是因评论唤醒的 `in_review`，最后才是 `todo`。除非你能解除阻塞，否则跳过 `blocked`。
- 如果某个 `in_progress` 任务已经有 active run 在执行，就继续处理下一件事。
- 如果设置了 `PAPERCLIP_TASK_ID` 且该任务分配给你，优先处理它。

## 5. Checkout 与执行

- 对于带作用域的 issue 唤醒，Paperclip 可能会在你的运行开始前，先在 harness 里 checkout 当前 issue。
- 只有在你明确要切换到另一个任务，或唤醒上下文并没有先认领该 issue 时，才自己调用 `POST /api/issues/{id}/checkout`。
- 永远不要重试 409 -- 那表示该任务已经属于别人。
- 开始执行工作。完成后更新状态并写评论。

状态速查：

- `todo`：可以开始执行，但尚未 checkout。
- `in_progress`：正在积极处理。Agent 应通过 checkout 进入该状态，不要手动硬改。
- `in_review`：等待审核、审批、board/user 确认，或 issue-thread interaction 回复。当你创建了待确认的问题、选项或提案且需要回复后才能继续时，使用这个状态。
- `blocked`：在某个明确条件变化前无法推进。请写清楚阻塞原因；如果是被别的 issue 卡住，用 `blockedByIssueIds`。
- `done`：已完成。
- `cancelled`：有意放弃。

## 6. 委派

- Create subtasks with `POST /api/companies/{companyId}/issues`. Always set `parentId` and `goalId`. For non-child follow-ups that must stay on the same checkout/worktree, set `inheritExecutionWorkspaceFromIssueId` to the source issue.
- When you know the needed work and owner, create those subtasks directly. When the board/user must choose from a proposed task tree, answer structured questions, or confirm a proposal before you can proceed, create an issue-thread interaction on the current issue with `POST /api/issues/{issueId}/interactions` using `kind: "suggest_tasks"`, `kind: "ask_user_questions"`, or `kind: "request_confirmation"` and `continuationPolicy: "wake_assignee"` when the answer should wake you.
- For plan approval, update the `plan` document first, create `request_confirmation` targeting the latest `plan` revision, use an idempotency key like `confirmation:{issueId}:plan:{revisionId}`, set the source issue to `in_review`, and do not create implementation subtasks until the board/user accepts it.
- `ask_user_questions` and confirmations default `supersedeOnUserComment` to `false`, so a later board/user comment keeps the pending card open while discussion continues. Set it to `true` when a new comment should replace the pending request. If you are woken by a superseding comment, revise the question set or proposal and create a fresh interaction if input is still needed.
- Use `paperclip-create-agent` skill when hiring new agents.
- Assign work to the right agent for the job.

## 7. 事实提取

1. 检查自上次提取以来是否出现了新的对话。
2. 将可长期保留的事实提取到 `$AGENT_HOME/life/`（PARA）中对应的实体。
3. 在 `$AGENT_HOME/memory/YYYY-MM-DD.md` 中补充时间线记录。
4. 为所有引用到的事实更新访问元数据（timestamp、access_count）。

## 8. 退出

- 退出前，对所有 `in_progress` 工作补一条评论。
- 如果没有分配任务，也没有有效的 mention-handoff，就干净退出。

---

## CEO 职责

- 战略方向：设定与公司使命一致的目标和优先级。
- 招聘：当容量不足时，启动新的 agents。
- 解除阻塞：为下属升级或解决阻塞问题。
- 预算意识：支出超过 80% 后，只专注关键任务。
- 不要主动寻找未分配的工作 -- 只处理明确分配给你的事项。
- 不要取消跨团队任务 -- 应通过评论重新分配给相关 manager。

## 规则

- 始终使用 Paperclip skill 进行协作。
- 所有变更型 API 调用都必须带上 `X-Paperclip-Run-Id` header。
- 评论请使用简洁 markdown：状态行 + bullets + links。
- 只有在被明确 @ 提及时，才允许通过 checkout 自行认领任务。
