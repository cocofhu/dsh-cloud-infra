# dsh-cloud-infra

DeepSeek Harness 插件：在对话中调用云厂商 OpenAPI。目前支持腾讯云全部产品（263 个产品、16,037 个 Action），写操作走 DSH 自带的审批，查询结果可以用内置的 Cloud View 组件（表格、图表、统计卡片等）展示。

设计见 [docs/design.md](docs/design.md)。

## 工具

| 工具 | 作用 |
|---|---|
| `cloud_accounts` | 列出已配置的账号（不含密钥） |
| `cloud_api_search` | 按关键词（中英文均可）搜索产品与 Action |
| `cloud_api_describe` | 查看某个 Action 的参数结构和返回字段 |
| `cloud_call` | 调用任意 Action；只读操作直接执行，其余需要用户审批。`version` 省略时取包含该 Action 的最新版本；`regions` 可对只读操作并发查询多个地域；参数会按 API 索引中的类型自动纠正（如 VPC 的 `Limit` 需要字符串） |
| `cloud_result` | 分页、按字段读取已缓存的调用结果 |
| `cloud_visualize` | 把缓存结果绑定到 Cloud View 组件展示给用户 |

Cloud View 只有 5 种组件，按 `items` 顺序从上到下排列：`stats`（统计卡片）、`table`（表格）、`chart`（line / bar / pie）、`kv`（单个资源详情）、`tabs`（标签页，不能嵌套）。图表和统计卡片会自己做分组、计数和求和，模型只需按 `ref` 绑定原始结果。

## 配置

账号可以在 DSH Web 的「插件 → @cocofhu/dsh-cloud-infra」页面里管理（新增、编辑、删除、测试连接、导入 tccli profile），也可以直接写在 profile 里：

```yaml
- id: cloud-infra
  name: '@cocofhu/dsh-cloud-infra'
  config:
    accounts:
      - id: prod
        provider: tencent
        source: store          # 密钥存在 DSH 凭据存储
        defaultRegion: ap-guangzhou
        readonly: true         # 拒绝一切写操作，不弹审批
      - id: dev
        provider: tencent
        source: tccli          # 读取 ~/.tccli/<profile>.credential
        tccliProfile: default
    tencent:
      tccliDir: ~/.tccli       # 可选
```

`dsh headless` 没有凭据存储，只能使用 `source: tccli` 的账号。

## 在 DSH 中的展示

`cloud_call` 的结果渲染在工具调用行里，会随 DSH 的「Called tools」分组一起折叠。`cloud_visualize` 生成的视图则作为独立卡片显示在对话中，位于工具分组和「Completed in」折叠之外，回合结束后仍然可见；工具分组里只保留一行调用记录。

为了让对话只保留一条滚动条，组件本身不做纵向滚动：
- 表格分页显示，默认每页 10 行；列太宽时只出现横向滚动条。
- JSON 和结果节选超过 20 行时折叠，点击「展开全部」查看。
- DSH 的「Called tools」分组默认最高 400px，包含 Cloud View 的分组会取消这个高度限制。

## 组件设计页

组件直接使用腾讯云控制台组件库 Tea（`tea-component` 2.8.0），跟随 DSH 切换亮色和暗色：表格（排序、筛选、分页）、标签页、指标卡（MetricsBoard）、只读表单、标签、按钮，以及设置页的表单控件都是 Tea 组件；图表仍用 ECharts。`tea-component` 的 npm 许可证是 `UNLICENSED`，本插件已获授权将其打包进 `lib/client.js` 一起发布，Tea 的第三方声明随包附在 `lib/tea-component.Attribution.txt`。

所有 Cloud View 组件的示例集中在一个设计页里，每个示例都用真实的 Spec 经过与 `cloud_visualize` 相同的校验和编译，可以查看对应的 JSON，并切换亮色和暗色主题。
- 在 DSH 中：「插件 → @cocofhu/dsh-cloud-infra」账号卡片右上角的「组件设计页」，或直接访问 `/cloud-infra/design/`。
- 单独运行：`pnpm design`，然后打开 http://127.0.0.1:5180/cloud-infra/design/ 。

示例数据和 Spec 在 `src/design/samples.ts`。新增组件或图表类型时在这里补充示例，测试会检查每种组件和图表类型都有示例、都能编译。

## 开发

```sh
pnpm install
pnpm build        # tsc + API 索引 + 浏览器端 bundle
pnpm test         # 构建并运行全部测试
pnpm typecheck    # Host 与 Client 两套 tsconfig
pnpm design       # 构建并在 5180 端口打开组件设计页
dsh plugin --profile web add link:$PWD
```

构建产物：

- `lib/host.js`：Host 插件。
- `lib/api-index/tencent/`：由 `tencentcloud-sdk-nodejs` 的类型声明生成的 API 索引，包括 0.9MB 的目录和 12MB 的按产品分文件。
- `lib/client.js`：Client 插件，约 250KB（gzip 约 60KB）。只打包用到的 Tea 组件（JS 约 110KB）和它们需要的 Tea 样式与主题变量（约 120KB）。
- `lib/client.echarts.js`：ECharts chunk（只含折线、柱状、饼图），约 600KB，出现图表时才加载。
- `lib/design-page/`：组件设计页，自带 React，由插件在 `/cloud-infra/design/` 提供。
