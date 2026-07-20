# Feature evidence Harness 调研与技术方案

日期：2026-07-20

## 问题

`features.json` 是 Plain 长周期迁移的机器可读退出门，但现有 `check-features.mjs` 允许被待验证文件本身降低要求：`completionEvidenceFields` 可删除必需字段，`schemaVersion` 接受任意正整数，complete feature 只需任意一条 command/result，且不证明每条 acceptance 都有证据。`progress.md` 的当前 WIP 也没有与唯一 active feature 交叉校验。

这会让尚未完成的 UI 或原生能力通过“改弱 schema + 填一句结果”伪装成 complete，违背 Harness 应当把产品退出门编码为不可自行降级合同的目标。

## GitHub 方案调研

- JSON Schema 官方规范把 `required`、`minItems`、`uniqueItems` 和对象属性约束定义为数据验证原语；省略 `minItems` 等价于允许空数组，因此必需证据不能只检查“是数组”。来源：[json-schema-org/json-schema-spec](https://github.com/json-schema-org/json-schema-spec/blob/main/specs/jsonschema-validation.md)。
- Ajv 官方仓库的最小严格示例同时使用固定 `required` 与 `additionalProperties: false`，说明验证规则应由 validator 持有，而不是让被验证文档声明自己要检查哪些字段。来源：[ajv-validator/ajv](https://github.com/ajv-validator/ajv)。
- OpenHands 的仓库级 Harness 把安装、lint、build 和测试命令写成仓库拥有的强制流程，并要求新增行为配套测试；这支持 Plain 继续把退出门留在版本化脚本与 hostile tests 中，而不是依赖人工自述。来源：[OpenHands/OpenHands AGENTS.md](https://github.com/OpenHands/OpenHands/blob/main/AGENTS.md)。

现成 JSON Schema validator 能验证单文件形状，但 Plain 还需要 `features.json` 与 `progress.md` 的 WIP 交叉约束，以及 acceptance 与 evidence 的一一映射；因此不新增通用依赖，保留小型纯函数 validator，并用 mutation tests 锁定这些跨文件语义。

## 技术方案

### Schema v3

- `schemaVersion` 必须精确为 `3`；删除可自我降级的 `completionEvidenceFields`。
- 根对象、feature 和 evidence 都使用固定闭集 key；字符串必须 trim 后非空，feature id/name/acceptance 唯一且按 phase/id 排序。
- `updatedAt` 必须是有效的 `YYYY-MM-DD`；`currentPhase` 必须与唯一 active feature 的 phase 一致。没有 active feature 时允许工作项切换间的 WIP 0，但 phase 不能低于已完成 feature 的最高 phase。
- `blocked` 与 `in_progress` 都占 WIP；`wipLimit` 继续精确为 `1`，避免修改清单本身绕过项目 WIP=1 规则。
- complete feature 必须有固定 evidence：`commands`、`results`、`nativeScenarios`、`platformGaps`、`acceptanceResults`。前四项都是字符串数组；commands/results 非空。phase 大于 0 的 UI/原生 feature 必须有 native scenario。
- `acceptanceResults` 与 acceptance 等长、按索引一一对应且每项非空。它只建立“每条退出条件都有明确证据说明”的机器门；证据真伪仍由对应命令、Browser/Tauri 验收和 Git 历史审计。
- 非 complete feature 禁止携带 evidence，避免半成品证据被误读为验收结果。

### 跨文件 WIP

- validator 从 `progress.md` 读取唯一 `- WIP：...` 行。
- 一个 active feature 时，progress 必须精确引用其 id；零 active feature 时必须写 `WIP：无`。
- 重复 WIP 行、未知 id 或与 `features.json` 不一致均失败。

### 可测试实现

- 新建无 I/O 的 `feature-contract.mjs`，导出 validator；CLI 只负责读文件、打印错误和设置退出码。
- Vitest 以当前合法文档为基线，逐项 mutation：删除/替换 schema 字段、空字符串、额外 key、缺失 acceptance evidence、空原生场景、blocked 超 WIP、phase/WIP 漂移和 progress 重复行都必须失败。
- 迁移现有 F001/F010 evidence 到 v3 后，运行聚焦测试、`pnpm check:features`、格式和 `git diff --check`；实现与验证作为下一独立提交。

## 非目标

- 本项不判断某条 evidence 描述是否真实执行；真实结果仍由本仓库测试、原生验收和代码审查证明。
- 本项不改变 F020 功能范围或状态，也不以 Harness 加强替代尚缺的 multi-root 与 Browser 失败路径实现。
