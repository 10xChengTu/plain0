# F230 非发布端到端完成度审计

日期：2026-08-05

## 目标

把每条非发布需求映射到当前可执行证据，分层报告，核查排除面不可达性与逐项提交完整性。审计只读；发现的真实缺口按最小工作项修复或如实登记，不为收账粉饰。

## 审计方法

### 1. 需求清单来源（穷尽两处）

- `docs/product-scope.md` 的「做什么」各节逐条。
- `features.json` F010–F220 的全部 acceptance 条目（F001 为基线项按 evidence 存在性核对）。

### 2. 证据分层（四层分别报告）

1. Rust 单测/集成（cargo test，当前 1562）。
2. 前端单测（vitest，当前 117 文件/2294）。
3. Browser E2E（Playwright，当前 192 场景）。
4. 真实 Tauri 桌面：E2E-001–E2E-024 已完成条目 + E2E-025/026/027/028 暂缓待执行条目（按用户 2026-08-04 指示攒批；审计如实分层列出，不将暂缓计为已执行）。

映射产出：每条需求 → 主张状态（achieved / achieved-automated-pending-desktop / narrowed（附 platformGaps 出处）/ gap），gap 必须给出精确文件:行证据。

### 3. 排除面不可达性核查

- `docs/bundle-baseline.json` 53 条 debt sources 的 category 地板未回涨（check:bundle 机械保证）+ categoryNotes 理由仍成立抽查。
- `app/excluded-surface-policy.ts` 运行时守卫的命令/视图拒绝清单与白名单（`plain.git.manageRemotes`、`plain.remote.*` 例外）逐条核对。
- 架构守卫清单完整性：`scripts/plain/check-boundaries.mjs` 引用的全部 validate* 与敌意变异测试对应关系抽查。
- AI/账号/同步/extension host/语言运行时五类禁止面：grep 级证据（无 SDK 依赖、无宿主入口、null extension service 仍唯一）。

### 4. 仓库整洁与提交完整性

- 工作树干净；`progress.md` 每条 `- [x]` 工作项能对应到独立提交（抽样核对 F140 起全部 feature 的切片提交哈希存在且信息与条目一致）。
- features.json 全部 complete 项 evidence 五字段完整（check:features 机械保证）+ 例外收账项（F190/F200/F210/F220）的暂缓声明一致性。

### 5. 执行方式

审计经并行只读 agent 分域执行（workspace/编辑/搜索、主题/图标、终端、Git、调试、远程、生命周期/本地工作流、排除面与守卫、提交完整性），汇总为 `docs/completion-audit.md` 报告；发现 gap 先修复或登记再收账。

## 垂直切片

1. **S1 审计执行与报告**：并行分域审计 → `docs/completion-audit.md`（需求×层级矩阵 + 排除面核查 + 提交完整性）→ 修复/登记发现项。
2. **S2 收账**：features.json F230 evidence、progress 收口；F230 的真实桌面维度如实指向暂缓的 E2E-025–028 批次。
