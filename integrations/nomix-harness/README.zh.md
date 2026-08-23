# @nomix-ai/nomix-ragflow

这是 RAGFlow 的类型化 REST 客户端与 Nomix Harness 插件。npm 包只负责连接，
不会捆绑或启动 RAGFlow；使用前必须已有可访问的 RAGFlow 服务。

## 安装

```bash
npm install @nomix-ai/nomix-ragflow
```

要求 Node.js `^22.19 || >=24`，首版面向 Nomix Harness `0.2.x`，发布契约固定
使用 Harness `0.2.4` 验证。

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
默认 MCP 地址为 `${baseURL}/api/v1/mcp`。使用独立 Python MCP 服务时配置：

```yaml
- id: ragflow
  config:
    baseURL: https://ragflow.example.com
    mcpURL: http://ragflow-mcp.internal:9382/mcp
```

Cordis 会整体替换一行的 `config`，因此在后续覆盖时还要重复写出需要保留的其他值。

MCP 桥接层保留 RAGFlow 动态提供的检索、数据集列表和聊天列表工具。插件另外
注册 8 个以 `action` 区分操作的领域管理工具，覆盖数据集、文档、文件传输、
分块、聊天、会话、Agent 和 Memory。

删除、批量删除、`deleteAll`、Memory forget 和取消解析在发送 REST 请求前必须
取得一次性人工审批。无审批服务、无活动 Agent、策略为 `never`、拒绝或取消时
均失败关闭。应用代码直接调用 `RagFlowClient` 不经过模型工具审批。

文档传输路径必须位于 `workspaceRoot` 内；符号链接、路径逃逸和覆盖已有下载文件
都会被拒绝，并受 `maxFileBytes` 限制。二进制内容通过 REST 流式传输，不经过
MCP/Base64。远程文件系统不能提供本地主机路径时，本地传输会明确报不支持。

根模块只提供命名导出：`name`、`inject`、`Config`、`apply`、`RagFlowClient`、
`RagFlowApiError`、领域客户端和所有公共类型。仅使用 REST 客户端时也可从
`@nomix-ai/nomix-ragflow/client` 引入。

许可证：Apache-2.0。

## 发布准备

在 GitHub 创建 `npm-publish` Environment，确认 `@nomix-ai` 对该包名有发布
权限，并添加具备 publish 与 2FA-bypass 权限的细粒度 `NPM_TOKEN` Secret。
推送 `nomix-ragflow-v0.1.0` 形式的标签会触发独立发布工作流；标签版本必须与
`package.json` 完全一致。已存在的 npm 版本会被拒绝，发布同时生成 provenance。
