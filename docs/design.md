# dsh-cloud-infra 设计

DeepSeek Harness（DSH）插件：让 Agent 在对话中调用云厂商的 OpenAPI，并用内置的可视化组件展示结果。v1 先支持腾讯云，抽象层面向多云。

- 包名：`@cocofhu/dsh-cloud-infra`
- 目标 DSH：`>=0.2.2-rc.1 <0.3.0`（developer preview，按 rc 版本跟进）
- 运行时：Node `>=22.19`，Host 侧 TypeScript，Client 侧 TSX

## 1. 目标与非目标

**目标**

1. 一个通用调用工具覆盖厂商的全部 API，不按产品逐个封装。
2. 写操作复用 DSH 自带的审批链路（权限预设、会话审批策略、审计日志），插件不另起一套确认机制。
3. 凭据不进入配置文件、不进入模型上下文；支持多账号。
4. 模型可以查到任意 Action 的参数，而不是靠记忆猜。
5. 提供一套声明式可视化组件（Cloud View），由 Agent 自行决定是否、以何种形式展示数据。
6. 新增云厂商只需实现 Provider 接口，工具、审批、可视化全部复用。

**非目标**

- 不做产品级适配：不为 CVM、CLB 等产品写专用卡片或专用转换逻辑。
- 不替代控制台：不做资源管理 UI、不做长期状态同步。
- 不依赖外部 CLI 运行时（见 §6.3 TCCLI 与 SDK 的取舍）。

## 2. 总体架构

```
┌──────────────────────────── Host（Node，插件进程内）────────────────────────────┐
│ tools                                                                            │
│   cloud_accounts  cloud_api_search  cloud_api_describe                           │
│   cloud_call ───────┐   cloud_result   cloud_visualize                           │
│                     │        ▲               │                                   │
│ policy              ▼        │               ▼                                   │
│   tools/pre-execute 风险判定 → allow / ask（走 DSH user-approval）                │
│   tools.guard       只读账号的单调拒绝                                            │
│                     │        │               │                                   │
│ core                ▼        │               ▼                                   │
│   ProviderRegistry  ResultStore（会话内结果缓存，ref = r1, r2…）  ViewCompiler    │
│   AccountRegistry   ApiCatalog（构建期索引，按产品懒加载）       （校验 + 绑定数据）│
│                     │                                                            │
│ providers           ▼                                                            │
│   tencent: CommonClient（tencentcloud-sdk-nodejs-common）+ tccli 配置读取        │
│   aliyun / aws / …: 以后实现同一接口                                              │
│                                                                                  │
│ webServer  /cloud-infra/api   设置卡片使用的账号管理接口                          │
└──────────────────────────────────────────────────────────────────────────────────┘
                         │ tool/result + presentationMeta（含已编译的 View）
                         ▼
┌──────────────────────────── Client（浏览器，React）─────────────────────────────┐
│ tool.call.toolview["cloud_call"]       请求摘要 + JSON 结果                       │
│ tool.call.toolview["cloud_visualize"]  ViewRenderer                              │
│ settings.plugin.item                   账号管理卡片                               │
│ ViewRenderer 注册表：kind → 组件（table / kv / stats / chart / tabs …）           │
│ client.echarts.js                      ECharts 懒加载 chunk                       │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**分层原则**

- Host 负责：凭据、签名调用、风险判定、数据裁剪、把 View 编译成自包含的 JSON。
- Client 只负责：按 `kind` 渲染已编译的 View。Client 不发云 API 请求、不接触凭据。
- View 存在 `presentationMeta` 里，会话回放时无需重新请求云 API 也能重现。

## 3. 包结构

```
dsh-cloud-infra/
  package.json            dsh.bundle + dsh.client 声明
  cordis.patch.yml        默认插入一行插件配置
  scripts/
    build-api-index.ts    从全量 SDK 的 .d.ts 生成 API 索引
    build-client.ts       esbuild 打包 Client，输出 ModuleLoader 格式
  src/
    host.ts               apply(ctx)：组装各部分
    config.ts             插件配置 Schema
    core/
      types.ts            CloudRequest / CloudResponse / RiskLevel / AccountInfo
      provider.ts         CloudProvider 接口 + ProviderRegistry
      accounts.ts         AccountRegistry：合并各来源账号
      risk.ts             风险分级规则引擎
      result-store.ts     会话内结果缓存
      json-path.ts        结果路径取值（cloud_result / View 数据绑定共用）
      errors.ts           CloudError + 错误码
      truncate.ts         面向模型的结果裁剪
    providers/tencent/
      index.ts            TencentProvider
      client.ts           CommonClient 封装（超时、取消、重试）
      credentials.ts      DSH credentials 与 ~/.tccli 两个来源
      risk.ts             腾讯云 Action 命名规则
      errors.ts           腾讯云错误码 → CloudError
      catalog.ts          读取 API 索引
    tools/
      accounts.ts  api-search.ts  api-describe.ts  call.ts  result.ts  visualize.ts
    policy/
      approval.ts         tools/pre-execute 钩子
    view/
      spec.ts             View Spec 类型（Host 与 Client 共用）
      validate.ts         View Spec 校验
      compile.ts          数据绑定 → 自包含 View
      catalog.ts          给模型看的组件说明
    client/
      index.tsx           apply：注册 slots
      renderer/           ViewRenderer + 各 kind 组件
      echarts/            懒加载 chunk 入口 + 主题
      settings/           账号管理卡片
  lib/                    构建产物（发布内容）
    api-index/            catalog.json + <service>.json
```

## 4. Provider 抽象

```ts
type RiskLevel = 'read' | 'write' | 'danger'

interface CloudRequest {
  provider: string          // 'tencent'
  account: string           // 账号 id
  service: string           // 'cvm'
  version?: string          // '2017-03-12'；缺省时取索引中的最新版本
  action: string            // 'DescribeInstances'
  region?: string           // 缺省时用账号默认地域；全局产品可为空
  params: JsonObject
}

interface CloudResponse {
  requestId?: string
  data: JsonValue           // 去掉厂商外壳后的业务数据
  durationMs: number
}

interface CloudProvider {
  readonly id: string
  readonly displayName: string
  accounts(): Promise<AccountInfo[]>                      // 不含密钥
  classify(req: CloudRequest): RiskLevel                  // 纯函数，pre-execute 中同步可用
  call(req: CloudRequest, signal: AbortSignal): Promise<CloudResponse>
  catalog: ApiCatalog                                     // search / describe / latestVersion
  testAccount?(account: string, signal: AbortSignal): Promise<{ ok: boolean; identity?: string; error?: string }>
}
```

新增厂商的工作量：实现 `CloudProvider`，提供该厂商的索引生成脚本和凭据来源。工具、审批、结果缓存、Cloud View 都不需要改。

## 5. 模型可用的工具

| 工具 | 作用 | 风险 |
|---|---|---|
| `cloud_accounts` | 列出可用账号：id、厂商、标签、默认地域、是否只读、凭据来源 | read |
| `cloud_api_search` | 按关键词或产品搜索 Action，返回 service/version/action/一行说明 | read |
| `cloud_api_describe` | 返回某个 Action 的完整入参结构、必填项和字段说明 | read |
| `cloud_call` | 调用任意 Action | 按 Action 判定 |
| `cloud_result` | 从已缓存结果中按路径取片段、分页、选字段 | read |
| `cloud_visualize` | 用 Cloud View 组件展示数据 | read |

### 5.1 `cloud_call`

参数：`provider`（默认 `tencent`）、`account`（只有一个账号时可省略）、`service`、`version?`、`action`、`region?`、`regions?`、`params`。

- `regions` 允许对**只读** Action 并发多地域查询，结果按地域合并为 `{ [region]: data | { error } }`。写操作只能指定单个 `region`。
- 返回给模型的内容：`ref`、`requestId`、耗时，以及裁剪后的 JSON（默认 16k 字符上限，超出时标明被省略的数组长度，并提示用 `cloud_result` 分页读取）。
- 完整结果存入 ResultStore，以 `ref` 引用，供 `cloud_result` 和 `cloud_visualize` 使用，避免大结果反复经过模型。
- `presentationMeta`：请求摘要（账号、地域、产品、Action、风险等级、RequestId、耗时）和有界的结果预览。Client 卡片只渲染这些内容，不做产品识别。

### 5.2 `cloud_result`

参数：`ref`、`path?`（如 `InstanceSet`、`InstanceSet[*].Placement.Zone`）、`fields?`、`offset?`、`limit?`。用于在不重新请求云 API 的情况下翻阅大结果。

### 5.3 `cloud_visualize`

参数：`title?`、`view`（Cloud View Spec，见 §8）。View 中的数据既可以内联，也可以通过 `{ ref, path }` 绑定 ResultStore 中的结果。返回给模型的只是一句渲染摘要（例如"已渲染表格，共 42 行"），不回传数据。

### 5.4 ResultStore

- 每个会话一个 LRU（默认 50 条、总计 64MB），`ref` 在会话内单调递增。
- 只在内存中，Host 重启后失效。引用失效时返回 `CLOUD_REF_EXPIRED`，提示模型重新调用 `cloud_call`。
- View 在编译时把绑定的数据物化进 `presentationMeta`，因此回放不依赖 ResultStore。

### 5.5 System prompt 片段

插件注入一个 `tool:cloud-infra` 段落，内容要点：

- 云资源操作只用 `cloud_*` 工具，不要在 bash 里执行 `tccli` 或厂商 CLI（那样会绕过审批）。
- 参数不确定时先 `cloud_api_search` / `cloud_api_describe`。
- 写操作会触发用户审批；被拒绝后不要换个方式重试同一操作。
- 数据适合表格、图表或汇总时，可以调用 `cloud_visualize`；简单问答直接用文字回答。

## 6. 凭据与账号

### 6.1 账号模型

账号元数据（非机密）存在插件 settings 里：

```yaml
accounts:
  - id: prod                # [a-z][a-z0-9-]*，同时用作 credential key 的一段
    provider: tencent
    label: 生产环境
    source: store           # store | tccli
    defaultRegion: ap-guangzhou
    readonly: true
  - id: dev
    provider: tencent
    source: tccli
    tccliProfile: default
```

### 6.2 凭据来源

| 来源 | 存储位置 | 说明 |
|---|---|---|
| `store` | DSH `ctx.credentials`，key 为 `cloud-infra/<provider>-<accountId>` | `ApiKeyRecord { env: { TENCENTCLOUD_SECRET_ID, TENCENTCLOUD_SECRET_KEY, TENCENTCLOUD_SESSION_TOKEN? } }`。由设置卡片写入，只能看到脱敏预览 |
| `tccli` | `~/.tccli/<profile>.credential` 与 `<profile>.configure` | 只读不复制：每次调用时重新读取文件，tccli 里轮换的密钥立刻生效。`.configure` 的 `_sys_param.region` 作为默认地域 |

- 未在 settings 中声明的 tccli profile 会作为"可导入"列在设置卡片里，用户确认后才成为账号。避免插件静默启用本机的全部密钥。
- 每次调用都重新解析凭据，不跨调用缓存（遵循 DSH credentials 的约定）。
- 密钥只在 Provider 内部使用：不出现在工具参数、工具结果、日志、`presentationMeta`、错误信息中。

### 6.3 TCCLI 与 SDK 的取舍

执行层使用 SDK（`tencentcloud-sdk-nodejs-common` 的 `CommonClient`），TCCLI 只作为凭据来源。

| | SDK `CommonClient` | TCCLI |
|---|---|---|
| 运行依赖 | 纯 Node，约 114KB | 需要 Python + `pip install tccli` |
| 覆盖面 | 任意产品、任意 Action | 任意产品、任意 Action |
| 单次开销 | 一次 HTTPS 请求 | 每次启动一个 Python 子进程（数百毫秒） |
| 错误 | 结构化：`code`、`message`、`requestId` | 需从 stdout/stderr 解析 |
| 取消与超时 | 接 `exec.signal` | 只能杀进程 |
| 安全面 | 无 shell | 需拼接命令行参数 |

## 7. 安全与审批

### 7.1 风险分级

按 Action 名前缀判定，规则可在配置中覆盖：

| 等级 | 腾讯云默认前缀 | 行为 |
|---|---|---|
| `read` | `Describe` `List` `Get` `Query` `Inquiry` `Inquire` `Check` `Search` `Preview` | 直接执行 |
| `danger` | `Delete` `Terminate` `Destroy` `Release` `Remove` `Reset` `Isolate` `Stop` `Reboot` `Shutdown` `Offline` `Unbind` `Disassociate` `Detach`，以及 `Modify*Password` | 需审批，审批文案标明高危 |
| `write` | 其余全部 | 需审批 |

未知或无法解析的 Action 一律按 `write` 处理（默认偏安全）。多地域调用 `regions` 只接受 `read`。

配置覆盖：

```yaml
riskRules:
  - { provider: tencent, service: cvm, action: 'RunInstances', level: danger }
  - { provider: tencent, action: 'Export*', level: write }
```

### 7.2 复用 DSH 审批

- 插件监听 `tools/pre-execute`：`cloud_call` 为 `read` 时调用 `next()`，否则返回 `{ kind: 'ask', reason, displayReason }`。工具流水线会把 `ask` 交给 `user-approval`，用户选择的权限预设、会话策略（`ask` / `never`）、审计日志全部沿用。
- `reason` 与 `displayReason` 包含账号、地域、`service.Action`、风险等级和关键参数摘要。参数里名称匹配 `Password|Secret|Token|PrivateKey` 的字段会脱敏。
- 只读账号用 `ctx.tools.guard()` 做单调拒绝，任何审批都无法放行。
- 审批卡片的 `conversation.approval.detail` 插槽是 `single` 类型、按 `callId` 关联。如果占用它会与其他插件冲突，就退回只用 `displayReason` 文本（M5 验证）。

### 7.3 其他约束

- `cloud_call` 默认超时 30 秒，可配置；`exec.signal` 取消时会中止 HTTP 请求。
- 节流类错误（`RequestLimitExceeded`）对只读请求做最多 2 次指数退避重试；写请求不自动重试，避免重复执行。
- Cloud View 只接受 JSON，不接受 HTML 或函数；ECharts option 中的外部资源引用（`image://http…`、`url(…)`）会被剥离。

## 8. Cloud View

一套由 Agent 自主选用的声明式可视化组件。插件只提供组件，不判断"哪个产品该用哪种视图"。

### 8.1 Spec 协议

```ts
interface ViewRoot { v: 1; title?: string; body: ViewNode }

type ViewNode =
  // 布局
  | { kind: 'group'; direction?: 'row' | 'column'; columns?: number; children: ViewNode[] }
  | { kind: 'tabs'; tabs: { label: string; body: ViewNode }[] }
  | { kind: 'card'; title?: string; subtitle?: string; body: ViewNode }
  // 数据
  | { kind: 'table'; data: DataSource; columns?: Column[]; rowKey?: string; pageSize?: number }
  | { kind: 'kv'; data: DataSource; items?: { label: string; path: string; format?: Format }[] }
  | { kind: 'stats'; items: { label: string; value: number | string | Binding; unit?: string; tone?: Tone; hint?: string }[] }
  | { kind: 'chart'; chart: 'line' | 'area' | 'bar' | 'pie' | 'scatter' | 'heatmap' | 'gauge'; data: DataSource; x?: string; y: string | string[]; series?: string; stack?: boolean; unit?: string }
  | { kind: 'echarts'; option: JsonObject; data?: Record<string, DataSource> }   // 高级出口，见 8.3
  | { kind: 'timeline'; data: DataSource; time: string; title: string; description?: string; tone?: string }
  | { kind: 'tree'; data: DataSource; label: string; children: string }
  // 文本
  | { kind: 'markdown'; text: string }
  | { kind: 'alert'; tone: Tone; text: string }
  | { kind: 'json'; data: DataSource }

type DataSource = JsonValue[] | JsonObject | Binding         // 内联或绑定
type Binding = { ref: string; path?: string }                // 指向 ResultStore
type Column = { key: string; title?: string; format?: Format; width?: number }
type Format = 'text' | 'number' | 'percent' | 'bytes' | 'currency' | 'datetime' | 'duration' | 'status' | 'tag' | 'code' | 'link'
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
```

- 路径语法（`key`、`path`、`x`、`y` 共用）：`a.b`、`a[0]`、`a[*].b`。`table` 未给 `columns` 时，从前 50 行推断标量列。
- `status` 格式按值的常见词（`RUNNING`、`STOPPED`、`FAILED`、`Normal` 等）上色。这是通用词表，不按产品区分。

### 8.2 编译（Host）

`cloud_visualize` 执行时：

1. 校验 Spec：未知 `kind`、缺字段、超深嵌套（> 6 层）返回 `ToolArgsError`，错误信息直接告诉模型哪里不对。
2. 解析每个 `Binding`，从 ResultStore 取值并物化。
3. 施加上限：单个数据源 2000 行，整个 View 序列化后 1MB。超出时截断，并在 View 中附带 `truncated` 标记。
4. 把编译后的自包含 View 放入 `presentationMeta`。

### 8.3 ECharts

- 用 `echarts/core` 按需注册 line、bar、pie、scatter、heatmap、gauge、graph、tree、sankey、radar 和常用组件，打成单独的懒加载 chunk `client.echarts.js`。只有页面上出现图表时，才通过 `require.async('./client.echarts.js')` 加载。
- `chart` 是简化形式，覆盖大多数场景；`echarts` 直接透传 option，`data` 中的绑定会作为 `dataset.source` 注入。透传的 option 会先经过 §7.3 的清洗。
- 主题根据 DSH 的 `--dsw-*` CSS token 在运行时生成，切换深浅色时重建。

### 8.4 Client 渲染器

```ts
type ViewComponent<K extends ViewNode['kind']> = (props: { node: Extract<ViewNode, { kind: K }>; render: (n: ViewNode) => ReactNode }) => ReactNode
const registry = new Map<string, ViewComponent<any>>()
```

- 未注册的 `kind` 或渲染异常会退回 `json` 视图，不会让整张卡片失败。
- 尽量复用 DSH 共享模块表中的 `@deepseek-ai/dsh-client-ui-primitives`（Button、JSON 和 Markdown 渲染器等），样式只使用 `--dsw-*` token。
- 表格使用共享模块表里的 `@tanstack/react-virtual` 做虚拟滚动。

### 8.5 扩展方式

- **新组件**：在 `view/spec.ts` 加类型，在 `view/validate.ts` 加校验，在 `view/catalog.ts` 加给模型看的说明，在 `client/renderer/` 注册组件。Host 与 Client 共享同一份类型。
- **新厂商**：不需要改 Cloud View。
- 协议升级时 `v` 加一，Client 继续保留旧版本的渲染能力，保证旧会话可回放。

## 9. API 索引

`scripts/build-api-index.ts` 在构建期运行：

1. 读取全量 SDK `tencentcloud-sdk-nodejs`（devDependency，不打包）下的 `tencentcloud/services/<svc>/<ver>/<svc>_client.d.ts` 和 `<svc>_models.d.ts`。
2. 用 TypeScript compiler API 解析：client 类方法得到 Action 和 JSDoc 说明；`<Action>Request` 接口得到入参树（展开到结构体，最多 4 层，递归类型截断）、可选性和字段注释。
3. 清洗注释：去 HTML 标签、压缩空白、保留链接文本，单字段说明截断到 300 字。
4. 输出：
   - `lib/api-index/tencent/catalog.json`：所有产品的 `service/version/action/一行摘要`，供搜索使用，启动时加载。
   - `lib/api-index/tencent/<service>.json`：该产品各版本的完整入参结构，`cloud_api_describe` 首次用到时懒加载。
5. 同一产品有多个版本时，默认使用最新版本，`version` 参数可指定旧版本。

搜索：对 Action 名做驼峰分词，加上中文摘要的二元组，按产品名、Action 名、摘要的加权分数排序，返回前 20 条。

## 10. 设置卡片与 Host 接口

- 注册到 `settings.plugin.item`：账号列表（来源、默认地域、只读开关、凭据状态的脱敏预览），新增和编辑账号、导入 tccli profile，以及"测试连接"按钮（腾讯云调用 `sts:GetCallerIdentity`）。
- Host 路由 `POST /cloud-infra/api`，`method` 取值：`accounts.list`、`accounts.save`、`accounts.remove`、`accounts.test`、`tccli.profiles`。
- SecretKey 只能写入、不能读回。界面上只显示 `describe` 返回的脱敏值。

## 11. 错误处理

工具失败时抛出带稳定 `code` 的 `HarnessError` 子类 `CloudError`：

| code | 来源 | 给模型的提示 |
|---|---|---|
| `CLOUD_NO_ACCOUNT` | 未配置账号或账号不存在 | 让用户去设置页添加账号 |
| `CLOUD_CREDENTIAL_MISSING` | 凭据未配置或 tccli 文件不可读 | 同上 |
| `CLOUD_AUTH_FAILED` | `AuthFailure.*` | 检查密钥是否有效 |
| `CLOUD_PERMISSION_DENIED` | `UnauthorizedOperation*`、`AuthFailure.UnauthorizedOperation` | 账号缺少 CAM 权限，不要重试 |
| `CLOUD_INVALID_PARAMETER` | `InvalidParameter*`、`MissingParameter`、`UnknownParameter` | 先调用 `cloud_api_describe` 再重试 |
| `CLOUD_NOT_FOUND` | `ResourceNotFound*`、`InvalidAction` | 检查资源 id、Action 或版本 |
| `CLOUD_THROTTLED` | `RequestLimitExceeded*` | 稍后重试 |
| `CLOUD_READONLY_ACCOUNT` | 只读账号上的写操作 | 不要尝试绕过 |
| `CLOUD_REF_EXPIRED` | ResultStore 中没有该 ref | 重新调用 `cloud_call` |
| `CLOUD_UPSTREAM` | 其他厂商错误、网络错误 | 原样附带厂商 `code`、`message`、`requestId` |

审批被拒绝或无可用审批时的错误由 DSH 流水线产生（`ApprovalError`），插件不重复处理。

## 12. 构建与发布

- Host：`tsc` 输出到 `lib/`。
- Client：`scripts/build-client.ts` 用 esbuild 打包两个入口：`lib/client.js`（主入口）和 `lib/client.echarts.js`（懒加载 chunk）。两者都包成 `window.__ModuleLoader__.load({ id, factory: (require) => … })` 的形式；`react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-*` 等共享模块保持 external，由注入的 `require` 解析。
- 索引：`scripts/build-api-index.ts` 输出到 `lib/api-index/`。
- `package.json` 声明 `dsh.bundle.patch`、`dsh.client`（`platform: 'web'`、`inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots']`），以及 `exports["./client"]`。
- 安装：`dsh plugin --profile web add @cocofhu/dsh-cloud-infra`。

## 13. 测试策略

- 单元测试（`node --test`）：风险分级、路径取值、结果裁剪、tccli 文件解析、错误码映射、View 校验与编译、索引解析。
- Provider 测试：注入假的 `CommonClient`，覆盖超时、取消、节流重试、多地域并发。
- 组装测试：在 DSH 测试运行时中加载插件，验证工具注册、`pre-execute` 对读和写返回的决策、只读账号的 guard。
- 可选在线测试：设置 `TENCENTCLOUD_SECRET_ID/KEY` 时，对 `sts:GetCallerIdentity`、`cvm:DescribeRegions` 做冒烟测试。
- Client：对各 `kind` 组件做渲染快照，验证未知 `kind` 退回 `json`。

## 14. 里程碑

| 阶段 | 内容 |
|---|---|
| M1 | 骨架；账号（store + tccli）；TencentProvider；风险分级 + 审批钩子 + 只读 guard；`cloud_accounts`、`cloud_call`、`cloud_result`；单元测试 |
| M2 | API 索引生成；`cloud_api_search`、`cloud_api_describe` |
| M3 | Cloud View Spec、校验与编译；`cloud_visualize`；Client 渲染器（非图表组件）；`cloud_call` 卡片 |
| M4 | ECharts 懒加载 chunk、`chart` / `echarts` 组件、主题适配 |
| M5 | 设置卡片与 Host 接口；审批详情插槽；多地域并发 |
| M6 | 第二个厂商（阿里云），检验抽象是否成立 |

## 15. 风险与待验证

- DSH 处于 developer preview，插件 API 可能有破坏性变更。用 `engines.dsh` 锁定兼容范围，并在 dsh-testsuite 中做回归。
- 外部构建的 Client chunk 格式（`client.<name>.js`）需要在 M4 用真实 DSH 验证加载路径。
- `conversation.approval.detail` 是 single 插槽，能否由插件占用需要在 M5 验证（备选方案见 §7.2）。
- 全量 SDK 的索引体积预计在数 MB 级别，需要在 M2 实测；必要时只保留各产品的最新版本。
- ECharts 体积较大，必须保持懒加载，主入口不能引入它。
