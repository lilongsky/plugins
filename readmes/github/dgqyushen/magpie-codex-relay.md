# magpie-codex-relay

[m​agpie](https://github.com/yetone/magpie) 插件：复用 magpie 里已经登录的
**ChatGPT / Codex 订阅**，把这个 provider 的请求改道到第三方 Codex 网关
（`openai_base_url` 那一类中转站），例如
`https://codex-relay.oaifree.com/backend-api/codex`。

内置的 `codex` 订阅保持原样。本插件是并列的第二个 provider：`codex-relay/<model>`，
两边用同一份登录、同一个账号，互不影响。

[English](README.en.md)

## 它做什么 / 不做什么

| | |
|---|---|
| 读 | `$CODEX_HOME/auth.json`（容器里 `/config/.codex/auth.json`），**只借 access token** |
| 写 | 不写任何文件。**绝不刷新、绝不改写** `auth.json` |
| 改 | 只换上游地址；请求体、请求头、流式响应原样转发，不翻译协议 |
| 不管 | refresh token 轮换（magpie 的内置 Codex 账号和 Codex CLI 自己管） |

为什么不刷新：Codex 的 refresh token 是一次性的，magpie 用 `codexMu` 文件锁保证只有
一方在续期。插件再插一脚会把 token 提前花掉，导致双方一起掉线。所以插件每次都重读
`auth.json`——magpie 后台续期后，插件下一次请求自然拿到新 token。

## 安装

```bash
magpie plugin add github:dgqyushen/magpie-codex-relay
magpie plugin login codex-relay     # 无需输入：直接借用 magpie 里的 Codex 登录
```

前提：magpie 里已经登录了 Codex 订阅（`magpie providers` 里 `codex` 是 `signed in`）。

本仓库带 `magpie-plugin` topic，所以也会出现在 magpie 的 Plugins 页面上。

## 配置上游

```bash
magpie plugin options magpie-codex-relay '{"baseURL":"https://codex-relay.oaifree.com/backend-api/codex"}'
```

（`plugin options` 按包名或完整 spec 找插件；`codex-relay` 是它内部的 provider id，
`plugin login` / `provider models` 用那个 id，`plugin options` 不用。）

| 键 | 默认 | 说明 |
|---|---|---|
| `baseURL` | `https://codex-relay.oaifree.com/backend-api/codex` | 上游网关地址，填到 `/backend-api/codex` 这一层 |
| `codexVersion` | `0.172.0` | 发给上游的 `version` 头。上游按它卡模型能力，太老会被 400 `requires a newer version of Codex` |

改完不需要重装插件；`magpie plugin options` 会重启 plugin host。

## 使用

```bash
magpie provider models codex-relay          # 看上游的模型目录
magpie codex codex-relay/gpt-5.6-sol        # Codex 走这个 provider
```

任何 agent 都可以用 `codex-relay/<model>`，与内置 `codex/<model>` 并列。

## 换上游的判据

请求打到的地址就是 `baseURL` + 路径（`/responses`、`/models`、`/wham/usage`）。
把 `baseURL` 指向一个本地假上游，它会收到请求并回自己的内容——以此确认改道生效，
而不是发回官方。

## 限制

- 只做 Responses 协议（`@ai-sdk/openai`）。上游必须说 Codex 的 Responses API。
- 上游若要求它自己的 key 而不是 ChatGPT token，这个插件不适用：它只借官方登录。
- access token 过期且 magpie 那边没续上时，上游回 401，账号会被标成需要重登；
  重新登录 magpie 的 Codex 订阅即可。
- 一个 provider 一个账号：官方那份登录。多账号请用 `CODEX_HOME` 分目录，插件按目录顺序取第一份未过期的。

## 文件

| 文件 | 作用 |
|---|---|
| `index.mjs` | 插件本体（provider + auth + loader 的改道 fetch） |
| `opencode.mjs` | 导出插件函数（host 按 `main` 加载） |
| `opencode2.mjs` | OpenCode 2.x 的 `{id, setup}` 面；本包不需要，留空实现 |
| `package.json` | `main`、`exports`、`magpie.options` 的默认值 |

## License

MIT
