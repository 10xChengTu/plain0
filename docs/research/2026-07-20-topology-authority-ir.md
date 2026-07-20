# Topology authority 共享 IR 与 provider binding 调研方案

日期：2026-07-20

## 问题

新增/替换 root 产品命令已经把当前命令 ID、mode、native FIFO、Workbench adoption、命令 holder 生命周期以及 app command writer 收进 Harness。独立可维护性复审同时确认两项后续工作：

1. `workspace-topology-contracts.mjs` 的 bootstrap、commands 和全 app authority 会分别遍历并解释部分相同语法事实；未来新增 terminal、Git、debug 等命令时，不应在三段大条件中重复推导同一 binding。
2. provider authority 仍有一个已实证旁路：保留当前直接注册的同时，把 `registerCustomProvider` 或 `createPlainWorkspaceConfigurationProvider` 赋给 alias，再额外创建或注册 provider；基于末级 call name 的计数看不到 alias call。

本项只重构 Harness 分析层并封闭 provider binding，不改变产品运行时、Tauri capability、workspace snapshot 或 Workbench provider 行为。

## GitHub 方案调研

### TypeScript Compiler API

TypeScript 官方 Compiler API 以 `Program`、`SourceFile` 和 `TypeChecker` 组织整个项目；`checker.getSymbolAtLocation(node)` 可以把 identifier 解析到声明 symbol。来源：[Using the Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)。官方编译器笔记也说明 binder 会为命名实体创建 symbol、处理 scope，并让多个声明归入同一 symbol。来源：[TypeScript Compiler Notes](https://github.com/microsoft/TypeScript-Compiler-Notes)。

完整 TypeChecker 可以准确处理 shadow、alias 和跨文件 re-export，但当前 Harness 输入还包括大量只存在于内存的 hostile mutations。为每个 mutation 建立带 node_modules 模块解析的 Program 会把结构门禁变成完整语义编译器，增加 I/O、错误归因和版本耦合；实际 `pnpm typecheck` 已负责生产源码的完整语义检查。因此本项不在 source contract 内再嵌一套 TypeChecker。

### typescript-eslint scope manager

`typescript-eslint` 在独立 scope manager 中建模 scope、definition、variable 与 reference，适合 ESLint 规则复用。来源：[typescript-eslint scope-manager](https://github.com/typescript-eslint/typescript-eslint/tree/main/packages/scope-manager)。它的抽象方向适合本项，但直接引入还需要 ESTree parser、visitor keys 和新的运行时依赖；Plain 当前 dev dependency 闭集不包含这些包，也没有必要为了不足 20 个受保护 binding 维护第二套 AST。

### eslint-scope

ESLint 的 `eslint-scope` 同样提供 scope/reference 分析。来源：[eslint-scope](https://github.com/eslint/js/tree/main/packages/eslint-scope)。它面向 ESTree JavaScript，不能直接消费当前 TypeScript compiler AST；加入转换层会比需要保护的边界更复杂，因此不采用。

## 冻结设计

### 一次分析、多个策略消费

保留已固定的 `typescript` 依赖，新增只读分析 IR，不引入新包：

- `analyzeSourceFile(sourceFile)` 只遍历一次，收集 module import/export、call、identifier、element/property access、变量/函数/参数声明及其父节点关系。
- `analyzeTopologyAuthority(appSources)` 生成按 `relativePath` 索引的冻结 IR，并派生 bootstrap、direct command writer、workspace registrar 与 provider registration facts。
- 现有 `validateBootstrap`、`validateGuardedCommands` 和 `validateTopologyAuthority` 分别验证启动顺序、单文件实现形状和全 app 唯一权威，但不再各自重新搜索相同 import/call/binding。
- IR 只表达语法事实，不把“允许什么”写进分析器；allowlist、产品命令 manifest 和 provider contract 继续由 validator-owned 常量决定。

这保留三层职责而消除重复分析：局部 implementation、bootstrap lifecycle、全 app ownership 仍是不同验收面，不合并成一个难以归因的布尔条件。

### Provider binding 闭集

`app/main.ts` 的 provider seam 固定为：

- `registerCustomProvider`：只能是 files override 的精确 named import；合法引用只有 import binding 和两个直接 call callee，调用顺序仍为 root scheme 在前、configuration scheme 在后。
- `createPlainWorkspaceFileSystemProvider`：合法引用只有精确 named import和唯一直接 factory call。
- `createPlainWorkspaceConfigurationProvider`：合法引用只有精确 named import和唯一直接 factory call。
- 两个 scheme 常量只能来自当前精确 named import，并只出现在对应直接注册参数中。
- provider 实例只能由各自 factory 的唯一结果声明产生；configuration provider 的合法引用继续限定为注册、coordinator 构造和初始配置路径所需位置。

以下形状全部失败：alias/bind、namespace/default/re-export、computed call、局部同名 wrapper、额外 factory/registration、binding 重赋值、把 factory 或 registrar 作为参数传递，以及在其他 app source 取得同一 authority。

### 不采用的方案

- **在每个 validator 继续按名字扫描**：会重复推导并把无关的 `terminal.initialize()` 误判为根 API `initialize`。
- **只增加几个 alias hostile test**：能修当前例子，但不能形成可复用的 binding 分析层。
- **新增 typescript-eslint/eslint-scope 依赖**：扩大 dev dependency 与 AST 表示面，收益不足。
- **完整 TypeChecker 嵌入每个 mutation**：与 `pnpm typecheck` 重复，且使结构失败依赖外部模块解析。
- **源码哈希**：虽然闭得最死，但会拒绝无害注释/格式变化，也无法说明违反了哪条产品合同。

## 最小提交顺序

1. **共享 IR 提取**：在不改变任何现有通过/失败结果的前提下提取 source/app authority analysis；保留生产等价 19-source 正向基线和全部 hostile tests，独立提交。
2. **Provider binding 闭合**：迁移 bootstrap/provider 校验到 IR，加入 alias、computed、额外注册、reassign、跨文件 authority hostile tests，独立提交。
3. **Remove root 产品命令**：只有 Harness 两项均通过后才开始，不把产品行为与分析器重构混在同一提交。

## 验收

- IR 提取前后的现有 538 个前端用例、架构与 bundle 结果保持一致。
- 全量 `appSources` 正向 fixture 必须直接通过，格式和无关对象方法变化继续通过。
- 每个 provider binding 只允许固定声明和固定引用节点；所有上述旁路至少有一个 hostile mutation。
- `pnpm check` 全绿，工作树无生成物；每个最小项分别提交。
