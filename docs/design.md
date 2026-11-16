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
│ tool.call.toolview["cloud_visualize"]  一行调用记录（视图已在对话中展示）        │
│ conversation.chat.node["cloud-infra-view"]  回合级 Cloud View 卡片                 │
│ plugins.bundle.config[包名]            插件页里的账号管理卡片                     │
│ ViewRenderer 注册表：kind → 组件（table / kv / stats / chart / tabs …）           │
│ client.echarts.js                      ECharts 懒加载 chunk                       │
│ /cloud-infra/design/                   组件设计页（独立页面）                     │
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
      catalog.ts          ApiCatalog：读取 API 索引、搜索、参数树展开
      coerce.ts           按索引类型纠正参数
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
    runtime.ts            resolveCall：账号、版本、参数纠正、风险、地域（审批钩子与工具共用）
    tools/
      accounts.ts  api.ts（search + describe）  call.ts  result.ts  visualize.ts
    web/
      api.ts              /cloud-infra/api 账号管理接口
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
      toolviews.tsx       cloud_call / cloud_visualize 卡片
      settings.tsx        账号管理卡片
      testing.ts          测试用入口（打包成 lib/tests/client-under-test.cjs）
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

参数：`view`（Cloud View Spec `{ title?, body }`，见 §8）。View 中的数据既可以内联，也可以通过 `{ ref, path }` 绑定 ResultStore 中的结果。返回给模型的只是一句渲染摘要（例如"已渲染表格，共 42 行"），不回传数据。

### 5.4 ResultStore

- 每个会话一个 LRU（默认 50 条、总计 64MB），`ref` 在会话内单调递增。
- 只在内存中，Host 重启后失效。引用失效时返回 `CLOUD_REF_EXPIRED`，提示模型重新调用 `cloud_call`。
- View 在编译时把绑定的数据物化进 `presentationMeta`，因此回放不依赖 ResultStore。

### 5.5 System prompt 片段

插件注入一个 `tool:cloud-infra` 段落，内容要点：

- 云资源操作只用 `cloud_*` 工具，不要在 bash 里执行 `tccli` 或厂商 CLI（那样会绕过审批）。
- 参数不确定时先 `cloud_api_search` / `cloud_api_describe`。
- 写操作会触发用户审批；被拒绝后不要换个方式重试同一操作。
- 数据适合表格、图表或汇总时，调用 `cloud_visualize` 并按 `ref` 绑定原始结果，由组件自己分组、计数、求和；不要把云数据复制到 bash 或文件里统计。简单问答直接用文字回答。
- 同一个只读 Action 要查多个地域时用 `regions`。

真实运行中观察到，模型最初会用 bash 统计数据、把 `kind` 写成 `type`，也会为每个地域单独调用 `cloud_result`。针对这些情况补充了上面的提示和工具描述中的完整示例，并在实现上支持了 `type` 别名和“对象的对象”展开成行（§8.1）。

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
- 审批卡片的 `conversation.approval.detail` 插槽是 `single` 类型，已经被 DSH 自带的审批组件占用，插件占用它会覆盖所有工具的审批界面。因此不使用该插槽，审批卡片中的详情只来自 `displayReason` 文本。
- 已在真实 DSH 中验证：`--approval-policy never` 时写操作被拒绝，模型收到 `the user rejected tool "cloud_call"` 后不再重试。

### 7.3 其他约束

- `cloud_call` 默认超时 30 秒，可配置；`exec.signal` 取消时会中止 HTTP 请求。
- 节流类错误（`RequestLimitExceeded`）对只读请求做最多 2 次指数退避重试；写请求不自动重试，避免重复执行。
- Cloud View 只接受 JSON，不接受 HTML 或函数；ECharts option 中的外部资源引用（`image://http…`、`url(…)`）会被剥离。

## 8. Cloud View

一套由 Agent 自主选用的声明式可视化组件。插件只提供组件，不判断"哪个产品该用哪种视图"。

### 8.1 Spec 协议

```ts
interface ViewRoot { v: 1; title?: string; items: ViewNode[] }   // 组件从上到下排列

type ViewNode = ContentNode | { kind: 'tabs'; tabs: { label: string; items: ContentNode[] }[] }   // tabs 不能嵌套

type ContentNode =
  | { kind: 'stats'; items: { label: string; value: number | string | (Binding & { agg?: Aggregate }); unit?: string; format?: Format; tone?: Tone }[] }
  | { kind: 'table'; title?: string; data: DataSource; columns?: Column[] }
  | { kind: 'chart'; chart: 'line' | 'bar' | 'pie'; title?: string; data: DataSource; x?: string; y?: string | string[]; series?: string; unit?: string; format?: Format }
  | { kind: 'kv'; title?: string; data: DataSource; items?: { path: string; label?: string; format?: Format }[] }

type DataSource = JsonValue[] | JsonObject | Binding         // 内联或绑定
type Binding = { ref: string; path?: string }                // 指向 ResultStore
type Column = { key: string; title?: string; format?: Format }
type Format = 'number' | 'percent' | 'bytes' | 'datetime' | 'status'
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
type Aggregate = 'count' | 'sum'
```

- 组件刻意保持很少：早期版本有 14 种组件（布局、时间线、树、Markdown、原生 ECharts 等）和 9 种图表，工具描述很长，模型容易写出校验不过的 Spec。现在只保留覆盖云资源查看场景的 5 种，多个组件直接从上到下排列，不需要布局组件。
- 路径语法（`key`、`path`、`x`、`y` 共用）：`a.b`、`a[0]`、`a[*].b`。`table` 未给 `columns` 时，从前 50 行推断标量列。
- `status` 格式按值的常见词（`RUNNING`、`STOPPED`、`FAILED`、`Normal` 等）上色。这是通用词表，不按产品区分。`percent` 表示数值已经是 0–100 的百分数（与云监控指标一致）。
- `table` 推断列时跳过所有样本行都为空（`null`、空字符串、空数组）的字段。
- `chart` 的数据形态：
  - 行模式：每行一个对象，按 `x` 分组；写 `y` 时求和，省略 `y` 时计数，`series` 把行拆成多条序列。
  - 行内序列：每行自带 x、y 数组，例如云监控 `DataPoints` 的 `Timestamps` / `Values`，每行一条序列。
  - 列模式：数据是一个包含平行数组的对象，`x`、`y` 指向其中的数组。
  - 时间轴自动识别：`x` 路径名像时间（`Time`、`Date`、`Timestamps` 等）且取值都是时间戳或日期字符串时，坐标轴按时间格式显示。
- 需要行的地方如果拿到“对象的对象”，例如多地域结果 `{ "<region>": data }`，就展开成每个条目一行 `{ key, ...value }`。这样一次调用就能按地域对比。
- 模型常把 `kind` 写成 `type`。`cloud_visualize` 只在组件（根 `items` 和标签页的 `items`）上接受这个别名，数据里的 `type` 保持不变。

### 8.2 编译（Host）

`cloud_visualize` 执行时：

1. 校验 Spec：未知 `kind`、缺字段、嵌套 tabs 返回 `ToolArgsError`，错误信息直接告诉模型哪里不对。
2. 解析每个 `Binding`，从 ResultStore 取值并物化。
3. 施加上限：单个数据源 2000 行，整个 View 序列化后 1MB。超过 1MB 时把行上限减半重新编译，最低 10 行，并在 View 中附带 `truncated` 标记。
4. 编译结果放在工具的 `value` 中，再由 `presentationMeta` 投影出 `{ kind: 'cloud-view', view }`。`value` 不写入会话日志，`presentationMeta` 会写入，所以回放会话时不需要结果缓存。返回给模型的只是一份简短的摘要，例如每个表格的行数和列名、每个图表的序列数。

### 8.3 ECharts

- 用 `echarts/core` 只注册 line、bar、pie 和 grid、legend、tooltip、dataZoom，打成单独的懒加载 chunk `client.echarts.js`（约 600KB）。只有页面上出现图表时，才通过 `require.async('./client.echarts.js')` 加载。构建脚本会检查主入口不含 ECharts。
- 不再提供透传 ECharts option 的出口，模型只能通过 `chart` 的几个字段描述图表。
- 主题使用腾讯云控制台图表配色，坐标轴、文字等颜色从图表容器上的 `--ci-*` token 读取，切换深浅色时重建。token 的透明度写成 `0.9` 而不是 `.9`，因为 ECharts 的颜色解析不认后者。

### 8.4 Client 渲染器

```ts
type ViewComponent<K extends ViewNode['kind']> = (props: { node: Extract<ViewNode, { kind: K }>; render: (n: ViewNode) => ReactNode }) => ReactNode
const registry = new Map<string, ViewComponent<any>>()
```

- 编译结果用内部的 `group`（纵向排列）承载根 `items` 和每个标签页。未注册的 `kind`（例如旧会话里已移除的组件）或渲染异常会退回折叠的 JSON，不会让整张卡片失败。
- 组件自带实现，只依赖共享模块表里的 `react`，样式统一使用 `ci-` 前缀。这样就不依赖 DSH 内部组件的 API 稳定性。
- 视觉采用腾讯云控制台的 Tea 规范：直角、12px 正文、`#006eff` 主色、表格和标签页样式、“状态点 + 文字”的状态显示、MetricsBoard 风格的统计卡片、“共 N 项 … 1 / N 页 ‹ ›”分页。颜色集中在 `styles.ts` 的 `--ci-*` token 中，亮色和暗色取值来自 Tea 的 `tea.css` 和 `tea-dark.css`，DSH 切换到暗色（`body[data-ds-dark-theme]`）时一起切换。
- 没有直接打包 `tea-component`：它的 npm 许可证是 `UNLICENSED`，没有授予再分发权利，而 DSH 插件必须把客户端代码打包进 `lib/client.js` 一起发布。它的 CSS 约 300KB，还带有约 100 条全局选择器，需要额外隔离。如果日后获得授权，可以把它作为和 ECharts 一样的懒加载 chunk 接入。
- 表格内置筛选、排序和分页，每页 10 行。

### 8.5 扩展方式

- **新组件**：在 `view/spec.ts` 加类型，在 `view/validate.ts` 加校验，在 `view/catalog.ts` 加给模型看的说明，在 `client/renderer/` 注册组件。Host 与 Client 共享同一份类型。
- **新厂商**：不需要改 Cloud View。
- 协议升级时 `v` 加一，Client 继续保留旧版本的渲染能力，保证旧会话可回放。

## 9. API 索引

`scripts/build-api-index.ts` 在构建期运行：

1. 读取全量 SDK `tencentcloud-sdk-nodejs`（devDependency，不打包）下的 `tencentcloud/services/<svc>/<ver>/<svc>_client.d.ts` 和 `<svc>_models.d.ts`。
2. 用 TypeScript compiler API 解析：client 类方法得到 Action 和 JSDoc 说明；`<Action>Request` 接口得到入参树（展开到结构体，最多 4 层，递归类型截断）、可选性和字段注释。
3. 清洗注释：去 HTML 标签、压缩空白、保留链接文本，单字段说明截断到 1200 字。过滤器字段会在说明里列出全部可用的 Name，所以需要较长的上限。
4. 输出：
   - `lib/api-index/tencent/catalog.json`：每个 Action 一行 `[service, action, 摘要, 版本?]`，约 0.9MB，首次搜索时加载。版本列只在该 Action 不在产品最新版本里时出现。
   - `lib/api-index/tencent/<service>.json`：该产品各版本的完整入参结构，共约 12MB，首次用到时懒加载，进程内保留最近 16 个产品。
5. 版本选择：`version` 省略时，取包含该 Action 的最新版本。例如 monitor 的最新版本 2023-06-16 只有 42 个 Action，`GetMonitorData` 会自动落到 2018-07-24。
6. SDK 4.1.344 的实测规模：263 个产品、16,037 个 Action，构建约 3 秒。

搜索：
- 每个英文单词和每段中文各算一个查询词组，按覆盖的词组比例加权，避免中文二元组的噪声压低排名。
- 中文先按内置词表切分，剩下的部分才切二元组。词表包括产品名（云服务器→cvm、负载均衡→clb 等）、资源名词（实例→instance、安全组→security 等）、动词（查询→describe、删除→delete 等）和泛化词（列表、信息等，只用于排序）。
- 同分时优先较短、较通用的 Action，例如 `DescribeInstances` 排在 `DescribeResourcePoolPackInstances` 前面。

参数纠正：`cloud_call` 按索引里的字段类型纠正标量参数，规则如下：
- 数字或布尔写进字符串字段时转成字符串，例如 VPC 的 `Limit` 要求字符串。
- 数字字符串写进数字字段时转成数字。
- `"true"`、`"false"` 转成布尔。
- 单个值写进列表字段时包成单元素列表。
- 嵌套结构体递归处理。未知字段和无法转换的值原样交给 API 报错。

## 10. 设置卡片与 Host 接口

- 卡片注册到 `plugins.bundle.config`，key 为包名，显示在「插件 → @cocofhu/dsh-cloud-infra」页面里。`plugins.item` 是官方设置页专用的插槽，第三方插件不应占用。卡片提供：
  - 账号列表：来源、默认地域、只读标记、凭据的脱敏预览。
  - 新增、编辑、删除账号，以及导入 tccli profile。
  - “测试连接”按钮，腾讯云调用 `sts:GetCallerIdentity`。
- Host 路由 `POST /cloud-infra/api`（需要 DSH 登录，只接受 JSON，校验同源，请求体最大 64KB）。浏览器端用相对文档的路径 `cloud-infra/api`，部署在代理前缀下也能访问。`method` 取值：`state`、`accounts.save`、`accounts.remove`、`accounts.test`。
- 持久化：DSH 0.2.2 没有 `settings.register`，改为把 `accounts`、`riskRules`、`timeoutMs`、`maxOutputChars` 声明为 `.volatile()` 配置。具体做法：
  - 写入用 `settings.update(entryId, patch)`，结果落在 profile 的 `cordis.patch.yml`。
  - Host 监听 `loader/volatile-update` 重新读取配置，不需要重启。
  - `settings.configure({ auto: false })` 关闭 DSH 为这些字段自动生成的表单。
- SecretKey 只写入 DSH 凭据存储，不进入配置文件，也不能读回。已在真实 DSH 中核对：密钥只出现在 `~/.dsh/.credentials.yaml`，profile 配置里只有账号元数据，删除账号时会一并删除密钥。

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
- `package.json` 声明 `dsh.bundle.patch`、`dsh.client`（`platform: 'web'`、`inject: ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-plugin-manager']`），以及 `exports["./client"]`。
- 组件设计页：`src/design/page.tsx` 单独打包到 `lib/design-page/`（ESM，自带 React，ECharts 拆成懒加载 chunk）。浏览器构建里把 `@deepseek-ai/dsh-tools` 换成只导出 `ToolArgsError` 的小模块，这样示例能直接走真实的 `validateView` 和 `compileView`。Host 用前缀路由 `/cloud-infra/design` 提供静态文件，`pnpm design` 也可以脱离 DSH 单独运行。
- 产物大小：`client.js` 约 35KB，`client.echarts.js` 约 600KB。构建时还会额外打一个 Node 可加载的 `lib/tests/client-under-test.cjs`，供服务端渲染测试使用，不随包发布。
- 安装：`dsh plugin --profile web add @cocofhu/dsh-cloud-infra`。

## 13. 测试策略

`pnpm test` 共 51 个用例，分为以下几组：
- 核心：风险分级、路径取值、结果裁剪、tccli 文件解析、错误码映射、节流重试、取消。
- 索引（基于真实生成的索引）：中英文搜索排序、按 Action 选版本、参数树展开、参数类型纠正。
- 工具流水线：在真实的 DSH 工具运行时里挂载 6 个工具，注入假 transport。覆盖以下流程：
  - search → describe → call → visualize 全流程。
  - 多地域部分失败。
  - 写操作与 `regions` 不能同时使用。
  - `cloud_result` 分页。
  - `type` 别名。
- 组装：加载整个插件，验证工具注册、审批钩子、只读 guard。
- Cloud View：校验错误的定位、各图表形态、对象展开成行、尺寸收缩、ECharts option 清洗。
- Web 接口：`dispatch` 的增删改测、`parseAccount` 校验，以及真实 HTTP 下的方法、内容类型、同源和请求体大小限制。
- Client：用 `react-dom/server` 渲染所有组件、9 种图表的 option、toolview 和 slot 注册，验证未知 `kind` 退回 JSON。

在线验证（密钥只通过环境变量传入，不写入仓库）：
- 腾讯云直连：`sts.GetCallerIdentity`、`cvm.DescribeRegions`、30 个地域并发 `DescribeInstances`、`vpc.DescribeVpcs`、`monitor.GetMonitorData`（自动选到 2018-07-24）。
- DSH headless + DeepSeek 模型：按状态和机型统计实例并可视化；45 个地域分布加 CPU 趋势图；审批拒绝；只读账号拒绝写入。
- DSH web：在浏览器里核对 toolview、ECharts 渲染、设置卡片的增删改测和凭据落盘位置。

## 14. 里程碑

| 阶段 | 内容 | 状态 |
|---|---|---|
| M1 | 骨架；账号（store + tccli）；TencentProvider；风险分级 + 审批钩子 + 只读 guard；`cloud_accounts`、`cloud_call`、`cloud_result`；单元测试 | 完成 |
| M2 | API 索引生成；`cloud_api_search`、`cloud_api_describe` | 完成 |
| M3 | Cloud View Spec、校验与编译；`cloud_visualize`；Client 渲染器（非图表组件）；`cloud_call` 卡片 | 完成 |
| M4 | ECharts 懒加载 chunk、`chart` 组件、主题适配 | 完成 |
| M5 | 设置卡片与 Host 接口；多地域并发（审批详情插槽不采用，见 §7.2） | 完成 |
| M6 | 第二个厂商（阿里云），检验抽象是否成立 | 未开始，需要阿里云账号 |

## 15. 风险与待验证

- DSH 处于 developer preview，插件 API 可能有破坏性变更。用 `engines.dsh` 锁定兼容范围，并在 dsh-testsuite 中做回归。
- 已验证：外部构建的懒加载 chunk（`client.echarts.js`）能被 DSH web 正常加载。
- 已验证：审批详情插槽被 DSH 占用，结论见 §7.2。
- 已验证：索引体积为目录 0.9MB 加产品文件 12MB，保留全部版本。
- DSH 0.2 会把工具调用放进「Called tools」分组，回合结束后再整体折叠进「Completed in Ns」。可视化结果不应藏在里面，所以客户端通过 `uiConversation.events.register` 注册了一个会话节点定义 `cloud-infra-view`：它匹配 `meta.kind === 'cloud-view'` 的 `tool/result` 事件，生成 `groupTree: 'turn'` 的聊天节点（与回合错误、回合尾部同级），由 `conversation.chat.node["cloud-infra-view"]` 渲染。这样卡片位于工具分组和回合折叠之外，始终可见，并按结果事件的顺序插在对话里。工具分组里的 `cloud_visualize` 行只保留一行调用记录。
- 这个子插件依赖 `uiConversation` 服务，单独用 `ctx.plugin` 加载；服务不存在时（旧版 DSH）不会加载，`cloud_visualize` 行会退回到直接渲染视图。
- 退回模式下，该分组内容默认最高 400px 并自行滚动，再加上表格、JSON 的内部滚动，会出现多层滚动条。现在的处理：组件不做纵向滚动（表格分页、长文本折叠），并用 `[data-step-process-body]:has(.ci-view)` 取消包含 Cloud View 的分组的高度限制，对话只保留一条滚动条。这依赖 DSH 的 `data-step-process-body` 属性；DSH 改名后只会退回到原来的 400px 滚动，不影响功能。
- 可能的后续方案：注册 `conversation.chat.markdown.fence` 的 `cloud-view` 语言层，让模型在最终回复里用代码块引用某次可视化，把视图渲染在不会折叠的回复正文中。这需要从聊天快照里按 callId 找到对应工具结果，会依赖 DSH 的内部数据结构，暂不实现。
- ECharts 体积较大，必须保持懒加载，主入口不能引入它。
