# Magpie 自动上下文压缩

## 介绍

Magpie 自动上下文压缩是一个 Provider 插件。它可在对话历史达到设定阈值时整理上下文，帮助长对话继续进行。支持 OpenAI Responses、Chat Completions 和 Anthropic Messages 上游。

## 安装

在插件目录运行：

```powershell
magpie plugin add "$PWD"
```

## 使用

1. 编辑配置示例，填入上游地址、API 密钥和模型。
2. 将配置导入 Magpie。
3. 运行 `magpie models` 查看可用模型，并在 Magpie 中选择 `供应商ID/模型别名`。

```powershell
$options = Get-Content -Raw -Encoding utf8 examples/options.jsonc |
  ConvertFrom-Json -ErrorAction Stop |
  ConvertTo-Json -Depth 100 -Compress
magpie plugin options magpie-autocompact $options
magpie models
```

此命令适用于 PowerShell 7 或更高版本。修改配置后，重新执行导入命令。

## 配置

从 [`examples/options.jsonc`](examples/options.jsonc) 开始配置。先修改启用的 `responses-main` 条目中的 `baseURL`、`key` 和模型 ID；其他示例条目默认关闭，可按需修改并启用。已有供应商配置时，将插件配置合并到同一个 `providers` 对象中。

常用选项：

- `protocol`：上游类型，支持 `responses`、`chat` 和 `anthropic`。
- `models`：可配置模型列表和 Magpie 中显示的模型别名；省略时尝试从上游获取模型。
- `maxMessages`：对话历史超过该条数时触发压缩；省略或设为 `0` 时不压缩。
- `maxRequests`：控制何时更换会话标识；省略或设为 `0` 时不更换。
- `enablePack`：控制是否启用最后一级的历史整理，默认开启。

配置文件是带注释的 JSONC，不能原样传给 Magpie；上面的命令会先解析配置再导入。不要在配置文件中保存真实密钥并提交到版本库。

## 开发

需要 Node.js 22.13 或更高版本。运行测试：

```sh
npm test
```

需要已安装 Magpie 才能运行集成测试：

```sh
npm run test:integration
```

## LICENSE

本项目使用 MIT License，详见 [`LICENSE`](LICENSE)。

## 致谢

感谢 Magpie 项目及所有为本项目提供反馈和贡献的使用者与维护者。
