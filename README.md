# dsh-cloud-infra

DeepSeek Harness 插件：在对话中调用云厂商 OpenAPI。先支持腾讯云，写操作走 DSH 自带的审批。

设计见 [docs/design.md](docs/design.md)。

## 工具

| 工具 | 作用 |
|---|---|
| `cloud_accounts` | 列出已配置的账号（不含密钥） |
| `cloud_call` | 调用任意 Action；只读操作直接执行，其余需要用户审批 |
| `cloud_result` | 分页读取已缓存的调用结果 |

## 配置

```yaml
- id: cloud-infra
  name: '@cocofhu/dsh-cloud-infra'
  config:
    accounts:
      - id: prod
        provider: tencent
        source: store          # 密钥存在 DSH 凭据存储
        defaultRegion: ap-guangzhou
        readonly: true
      - id: dev
        provider: tencent
        source: tccli          # 读取 ~/.tccli/<profile>.credential
        tccliProfile: default
```

## 开发

```sh
pnpm install
pnpm test
dsh plugin --profile web add ./
```
