# @nomix-ai/nomix-ragflow

这是 RAGFlow 的类型化 REST 客户端与 Nomix Harness 插件。npm 包只负责连接，
不会捆绑或启动 RAGFlow；使用前必须已有可访问的 RAGFlow 服务。

## 安装

```bash
npm install @nomix-ai/nomix-ragflow
```

要求 Node.js `^22.19 || >=24`。插件入口面向 Nomix Harness `^0.2.5`，Cordis、
Schemastery 和其他插件运行时模块均解析到 Harness 内置 kernel，不再自行安装副本。

## TypeScript 直接调用

```ts
import { RagFlowClient } from '@nomix-ai/nomix-ragflow'

const ragflow = new RagFlowClient({
  baseURL: 'https://ragflow.example.com',
  apiKey: process.env.RAGFLOW_API_KEY!,
})

const datasets = await ragflow.datasets.list({ page: 1, pageSize: 20 })
const chunks = await ragflow.retrieval.search({
  datasetIds: [datasets[0].id],
  question: '最新版本有哪些变化？',
})
```

每个 REST 方法均接受 `{ signal }`。HTTP 错误或非零 RAGFlow 响应码会抛出
`RagFlowApiError`，错误信息不会泄漏 API Key。

## Nomix Profile / Cordis 配置

先把插件 bundle 安装到对应的 Harness Profile：

```bash
nomix plugin --profile my-profile add @nomix-ai/nomix-ragflow
```

bundle 会插入一条默认禁用的 `ragflow` Cordis 配置，因为无法预先猜测部署地址和
凭证。请在该 Profile 自己的 `cordis.patch.yml` 中启用并配置；Profile patch 会
在 bundle patch 之后应用：

```yaml
- id: ragflow
  disabled: false
  config:
    baseURL: https://ragflow.example.com
    serverName: ragflow
    workspaceRoot: .
    maxFileBytes: 536870912
```

推荐在 Harness 启动环境中设置 `RAGFLOW_API_KEY`；也可以显式配置 `apiKey`。
RAGFlow MCP 是独立服务，插件不会再从 `baseURL` 猜测它的地址。需要启用 3 个
动态检索工具时，请显式配置 Python MCP 服务：

```yaml
- id: ragflow
  disabled: false
  config:
    baseURL: https://ragflow.example.com
    mcpURL: http://ragflow-mcp.internal:9382/mcp
    serverName: ragflow
```

省略 `mcpURL` 时，插件只加载 8 个 REST 管理工具。Cordis 会整体替换一行的
`config`，因此在后续覆盖时还要重复写出需要保留的其他值。

当 `serverName` 为 `ragflow` 时，MCP 桥接层把 3 个动态工具注册为
`mcp__ragflow__ragflow_retrieval`、`mcp__ragflow__ragflow_list_datasets` 和
`mcp__ragflow__ragflow_list_chats`。插件另外注册 8 个以 `action` 区分操作的
领域管理工具，覆盖数据集、文档、文件传输、分块、聊天、会话、Agent 和 Memory。

删除、批量删除、`deleteAll`、Memory forget 和取消解析在发送 REST 请求前必须
取得一次性人工审批。无审批服务、无活动 Agent、策略为 `never`、拒绝或取消时
均失败关闭。应用代码直接调用 `RagFlowClient` 不经过模型工具审批。

文档传输路径必须位于 `workspaceRoot` 内；符号链接、路径逃逸和覆盖已有下载文件
都会被拒绝，并受 `maxFileBytes` 限制。二进制内容通过 REST 流式传输，不经过
MCP/Base64。远程文件系统不能提供本地主机路径时，本地传输会明确报不支持。

包根模块和 `@nomix-ai/nomix-ragflow/client` 只导出可独立使用的 REST 客户端，
不要求安装 Harness。Cordis Loader 使用
`@nomix-ai/nomix-ragflow/plugin`，该子入口以命名方式导出 `name`、`inject`、
`Config` 和 `apply`，不提供默认导出。该插件入口必须运行在 Harness 内，所有外部
`@nomix-ai/*` 导入由 Harness 内置 kernel 提供。

许可证：Apache-2.0。

## 发布准备

在 GitHub 创建 `npm-publish` Environment，确认 `@nomix-ai` 对该包名有发布
权限，并添加具备 publish 与 2FA-bypass 权限的细粒度 `NPM_TOKEN` Secret。
把发布提交推送到 `npm-nomix-ragflow` 分支后，工作流从 `package.json` 读取版本，
在 Linux、Windows 和 macOS 上完成验证，再发布 Linux 制品。PR 和 `nomix-v*`
标签只执行相同验证，不发布。已存在的 npm 版本会被拒绝，发布同时生成 provenance。
