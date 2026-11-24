# 补丁更新（`magpie-patch-updater`）

用于在**保留自定义补丁**的前提下更新 Magpie 插件。

Magpie 会定期自动更新 `@latest` 插件并整包覆盖 `node_modules/`，直接修改插件源码会在下次更新时丢失。本插件将目标插件独立托管到本地目录，每次同步上游新版时自动重放补丁并通过校验后再切换生效。

---

## 技术概述

- **作用边界**：仅针对 Magpie 的 JS 插件包（`@magpie-community/*`），不修改 Magpie 主程序二进制。底层托管与更新流水线支持任意多目标插件；当前内置 `@magpie-community/opencode-agy-cli-auth`（`agy-cli`）的 3 个补丁，其他插件可通过新增补丁模块接入。
- **本地目录托管**：目标插件解包存放在 `~/.config/magpie/patched-plugins/<id>/`，以本地路径方式注册到 Magpie。Magpie 不会覆盖本地路径插件，目录切换后会自动触发平滑热重载；账号凭据按 Provider ID 保存在 `plugin-auth.json` 中，切换插件来源不会影响已有登录态。
- **隔离更新与回滚流水线**：
  1. **拉取校验**：从 `magpie-community/plugins`（`dist/index.json`）获取最新版本并校验 tarball 的 SHA-512。
  2. **暂存打补丁**：在受管目录之外的 `.staging` 临时目录解包，先运行 `detectUpstreamed`（若上游已原生修复则自动跳过并提示关闭），再按锚点规则应用补丁。
  3. **校验门禁**：依次执行 JS 语法检查、各补丁 `verify` 断言及隔离环境下的入口模块加载检查；任一环节失败即中止，当前生效目录保持不变。
  4. **原子切换**：将旧版本归档至 `.snapshots`（保留最近 3 个快照），再原子替换为新版本，支持一键回滚。

---

## 使用方法

### 1. 安装插件

```bash
magpie plugin add github:l1nxuan-du/magpie-patch-updater
```

安装后可在 Magpie 左侧边栏 **Plugins › 补丁更新** 打开管理页。

### 2. 接管并切换目标插件（以 `agy-cli` 为例）

1. 打开 **补丁更新** 页面，点击右上角 **「接管认证插件」** 生成本地补丁副本，并按需开关页面中的补丁项。
2. 在终端停用原 `@latest` 插件，改用本地托管目录：

   macOS / Linux：
   ```bash
   magpie plugin off @magpie-community/opencode-agy-cli-auth@latest
   magpie plugin add "$HOME/.config/magpie/patched-plugins/opencode-agy-cli-auth"
   ```

   Windows（PowerShell）：
   ```powershell
   magpie plugin off @magpie-community/opencode-agy-cli-auth@latest
   magpie plugin add "$HOME\.config\magpie\patched-plugins\opencode-agy-cli-auth"
   ```

### 3. 日常更新、回滚与还原

日常操作直接在 **补丁更新** 页面完成：
- **检查更新**：查询上游是否有新版本。
- **预演校验**：仅在临时目录试打补丁并校验兼容性，不改动当前版本。
- **应用更新**：下载新版、自动重打已启用补丁并切换生效。
- **一键回滚**：退回最近一次更新前的快照版本。

等价命令行用法（在插件目录下执行）：
```bash
bun run cli.mjs <adopt|check|dry-run|update|status|rollback|toggle-patch> [--id <id>] [--json]
```

如需退出托管并恢复官方原版：
```bash
magpie plugin rm "$HOME/.config/magpie/patched-plugins/opencode-agy-cli-auth"
magpie plugin on @magpie-community/opencode-agy-cli-auth@latest
```

---

## 内置补丁与扩展开发

### 内置补丁（`opencode-agy-cli-auth`）

| 补丁 ID | 名称 | 默认 | 上游关联 | 作用 |
| --- | --- | --- | --- | --- |
| `agy-401-recovery` | 401 认证过期自动重连恢复 | 启用 | `magpie-community/plugins#1296` | 识别长驻 `agy acp` 进程的 OAuth 过期错误，回收旧进程并透明重试一次 |
| `agy-silence-timeout-15m` | 静默超时放宽至 15 分钟 | 关闭 | `magpie-community/plugins#1465` | 将单轮静默超时默认值由 5 分钟放宽至 15 分钟 |
| `agy-executor-error-guard` | 拦截执行器错误避免误判 200 | 关闭 | `magpie-community/plugins#1467` | 拦截流末尾独立行 `⚠ agent executor error:`，作为错误返回而非 200 |

### 为其他插件编写补丁

在 `patches/<target-id>/<patch-id>.mjs` 中导出以下字段并在 `patches/index.mjs` 的 `REGISTRY` 注册，即可通过 `cli.mjs adopt --id <target-id> --package <pkg>` 纳入托管与界面管理：

- 元数据：`id`、`title`、`upstreamRef`、`enabledByDefault`
- `detectUpstreamed(dir, { fileCache })`：检测上游源码是否已包含对应修复，返回 `{ upstreamed, reason }`
- `apply(dir, { fileCache })`：基于 `applyAnchorEdits` 修改目标文件，返回 `{ applied, summary, conflict? }`
- `verify(dir, { fileCache })`：校验修改后的关键代码特征，返回 `{ ok, error? }`

---

## 许可证

MIT
