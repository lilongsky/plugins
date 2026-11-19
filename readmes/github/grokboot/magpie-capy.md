# magpie-capy 0.2.2

**Capy 任务平台工具（非模型提供方） · MIT 源码许可 · 品牌归属见 `docs/attribution.md`**

在 Magpie 中配置组织 API Key 后，智能体可读取项目、线程、子代理、消息，并以有界时间观察线程 SSE；写入默认关闭。

> English overview: [below](#english). 中文完整说明也保存在 `README.zh-CN.md`。Capy 名称与图标属于 Capy 品牌。

## 安装

首选官方 CLI 的 GitHub 规格安装：

```bash
magpie plugin add github:grokboot/magpie-capy
```

桌面版：**插件 → 添加插件 → GitHub**，填入 `grokboot/magpie-capy`。

`Discover` 页会把本插件标为 **Unofficial**：GitHub 上的 `magpie-plugin` topic 是官方支持的未审阅收录路径，本插件不在官方审核列表内，也不是 Capy 或 Magpie 官方插件。GitHub 搜索已能索引到该仓库；Magpie 的应用内缓存约 10 分钟，Discover 的 GUI 显示仍在验证中。

发布归档同样可用，顶层文件夹固定为 `magpie-capy/`，无需手动改名：

```bash
tar -xzf magpie-capy-0.2.2.tgz
magpie plugin add ./magpie-capy
```

开发时也可直接装源码目录：

```bash
git clone https://github.com/grokboot/magpie-capy
magpie plugin add ./magpie-capy
```

## 配置 API Key（真正的 Magpie 登录/配置）

1. 在 **Capy 设置 → API** 手动创建组织 API Key。
2. 在 Magpie 的 **插件 → Capy（任务工具）** 行点击 **配置 Capy 组织 API Key**。
3. Magpie 将密钥保存在自己的 `plugin-auth.json`（600）；插件不把密钥写入公开选项、页面、URL、日志或工具结果。
4. 登录/刷新时做一次只读 `GET /api/v1/projects` 验证；用量卡片显示“只读连接已验证”或具体错误，401 标记登录过期。

**Provider 徽标说明**：Capy 行里的 `Provider` 只是 Magpie 的零模型认证命名空间，用于显示登录入口；它**不提供模型、不做推理、没有 completion 端点**。工具通过独立的 MCP 工具服务器提供给智能体。不要为了消除 Provider 徽标而伪造模型或改宿主分类。

兼容旧安装：`CAPY_API_KEY` 仍有效且优先；用量卡片会说明工具实际使用环境变量还是 Magpie 登录。环境变量格式无效会显示配置错误。Magpie 可保存多个账号，但工具调用没有账号选择器；检测到多个账号时工具会安全停止，不会静默使用最后一个账号。

### 清除

使用插件行退出登录，或 `magpie plugin logout capy`，再按需移除环境变量。宿主认证文件由 Magpie 管理；刚退出时内存中的旧密钥会在 Magpie 下一次 provider 刷新/无认证回调时清除。

## 交给智能体与 MCP

看到 **工具，已对智能体隐藏** 时，这是宿主暴露设置。点击 **交给智能体**，再到 Library → MCP 或路由器确认目标智能体。也可手动添加 `http://127.0.0.1:3425/mcp/magpie/tools`。登录与工具暴露是两件独立的事。

## 选项与写入

插件行现在有 **Options**。默认示例：

```json
{"allowWrites": false}
```

写入默认关闭。需要时可将 `allowWrites` 设为 `true`，或在环境中设置 `CAPY_ALLOW_WRITES=true`。Options 是公开的非密钥策略，**绝不能填 API Key**。每次写入仍须 `confirm:true`；创建/发消息可能执行命令、消耗额度或创建 PR。

## 从 0.1.0 升级

更新或重新添加本目录。插件登录保存在 Magpie 的 `plugin-auth.json`，通常不会因重新加载源码丢失；环境变量也不受影响。

## 宿主边界

- 本地文件夹详情与 npm registry 卡片元数据来源不同；仅靠 manifest 不能完全补齐 registry 版本/许可证/摘要展示。
- 最终 0.2.2 tgz 使用真实构建时间（或显式非未来 `SOURCE_DATE_EPOCH`）；从本地文件夹复制仍可能沿用文件系统时间。
- “隐藏”、MCP 路由、按智能体授权和 Provider 徽标均由 Magpie 宿主控制。

## 测试与限制

`bun run check`、`bun run check:openapi`、`npm pack --dry-run`。测试只使用合成密钥和 mock fetch；没有真实 Capy API 凭证，未宣称真实 API 端到端成功。GUI 验收已在 0.2.1 提取归档上覆盖图标、中文 README、版本/MIT、Options 和登录/取消流程；0.2.2 只改版本元数据、文档与测试，尚未做新的 GUI 验收。归档测试直接校验 tar 头 epoch，并在 UTC、Asia/Shanghai、America/Los_Angeles 三种时区下验证条目元数据一致。

## English

A Magpie task-tool plugin for Capy projects, threads, subagents, messages, and bounded SSE. Capy is a task platform, not an inference provider. The `Provider` badge is Magpie's zero-model auth namespace for the API-key sign-in; tools are offered separately through MCP. Configure the organization key in **Plugins → Capy（任务工具）** or use `CAPY_API_KEY`; writes stay off unless `allowWrites` is saved in Options or `CAPY_ALLOW_WRITES=true`, and every write still needs `confirm:true`. Install with `magpie plugin add github:grokboot/magpie-capy`, or in the app via **Plugins → Add plugin → GitHub**. `Discover` labels the plugin **Unofficial**: the GitHub `magpie-plugin` topic is the officially supported unreviewed route, and the repo is indexed by GitHub search, but the app cache is about ten minutes and the in-app Discover display is still pending GUI verification. GUI acceptance on the 0.2.1 artifact covered the icon, Chinese README, version/MIT, Options `false`, and the organization-key dialog opened/cancelled without a credential. 0.2.2 changes only version metadata, docs, and tests, so it has no new GUI pass yet. No real Capy API credential or live API success is claimed. See `docs/ux-auth-exposure.md`, `README.zh-CN.md`, and `SECURITY.md` for details and host limits.
