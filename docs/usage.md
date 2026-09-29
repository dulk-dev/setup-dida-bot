# 日常用法与标签

本文是 [README](../README.md) 的细则：怎么在滴答里派活、标签语义、反例。webhook 载荷与例程提示词见 [webhook.md](webhook.md)。

中国区账号用 **dida365.com**；不要换成 ticktick.com（账号不互通）。国际版 TickTick 需自行确认 CLI / API 是否同一套登录。

## 日常用法

| 你想做的事 | 在滴答里怎么写 | daemon 做什么 |
|------------|----------------|---------------|
| 微信拆条后让机器人执行 | 转发正文以「动词 + 对象 `@bot`」结尾。助手通常拆成带 `微信采集` 的上下文，外加标题含 `@bot`、正文为空的碎片 | 窗口内恰好 1 条合法上下文时合并并打 `todo`；webhook 成功后改为 `doing` |
| 在已有未完成任务里下达 | 在**正文**写入或追加明确指令（可含 `@bot`），并打上叶子 **`todo`** | 不合并。`todo` 触发认领；正文指令给被唤醒的 Bot |
| 正文已经清楚，直接派发 | 打叶子 `todo` 即可，可以没有 `@bot` | 与上一行相同，走认领 |
| 普通收件箱任务 | 不写 `@bot`，也不打 `todo` | 不派发 |

### 反例

| 这样做 | 实际发生 |
|--------|----------|
| 只在正文写 `@bot`，不打 `todo` | 不派发（除非另有合并路径把它打成 `todo`） |
| 把「标题 `@bot` + 空正文」当成已有任务下达 | 这是依赖碎片，走窗口合并；找不到唯一上下文就不会派发 |
| 同一窗口里有两条及以上合法上下文，指望它挑一条合并 | 不合并。碎片标题变成 `@not …`，并打上 `freeze` |
| 用父标签 `bot` 或路径 `bot/todo` 去筛选 / 派发 | Open API / CLI filter 按**叶子名**匹配（如 `todo`） |
| `webhookUrl` 为空，指望 `todo` 变成 `doing` | 不认领，标签保持 `todo` |
| 指望本服务把任务标成 `done` 或勾成已完成 | 不会。`done` 由配套 Bot 写；本服务不改滴答完成状态 `status` |
| 碎片已是 `@not` 或仍带 `freeze`，指望下轮自动再合并 | 跳过。两个信号都要清掉，见下方 |
| 窗外遗留（创建时间差超过配置窗） | 不会自动合；调大 `dependencyWindow*Ms`、手工合并，或清掉碎片后重来 |

矛盾任务要交回自动合并时：去掉叶子 `freeze`，把标题里的 `@not` 改回 `@bot`，并让窗口内只留一条合法上下文。只改其中一个不够。

## 标签与标题标记

约定结构（默认名，均可在 `config.json` 整组改名）：

```text
bot                    ← 父标签 tagParent
├── todo               ← 待办（合并后 / 手工派发）
├── doing              ← 已认领，等待或正在被 Bot 处理
├── done               ← Bot 做完后写入
└── freeze             ← 歧义碎片，不再自动合并
```

| 名字 | 角色 | 谁写入 |
|------|------|--------|
| `bot` | 父标签，只分组。不要用它做派发 filter | daemon 在缺失时创建（`ensureParentTag`） |
| `todo` | 可派发 | 合并成功的主任务；或你手工打叶子 |
| `doing` | 已认领 | daemon，且仅在 webhook 返回成功之后 |
| `done` | 做完 | **配套 Bot**。本服务只确保标签名存在，从不写到任务上 |
| `freeze` | 矛盾、待手工处理。不是生命周期 | daemon 在窗口内 ≥2 条上下文时写下；处理完后由你去掉 |
| `微信采集` | 来源信号，参与依赖匹配 | 微信→滴答采集。不是派发标签 |
| `@bot` / `@not` | 写在**标题**里的字面标记，不是标签 | 你 / 微信助手 / daemon（歧义时 `@bot`→`@not`） |

一个任务同一时间只有一片生命周期叶子（`todo` / `doing` / `done`）。认领时去掉这三片再加 `doing`，其它标签保留（含 `微信采集` 与 `freeze`）。

### daemon 会自动创建什么

`ensureParentTag: true`（默认）时，每轮开始会：

- 缺少父标签 `bot` → `dida tag create`
- 缺少 `todo` / `doing` / `done` / `freeze` → 建为 `bot` 的子标签

因此一般不必手建这五个；跑通 `npm run once` 或 `daemon` 后用 `dida tag list --json` 核对即可。

若 `ensureParentTag: false`，须事先建好（App 或）：

```bash
dida tag create --name bot --label bot --json
dida tag create --name todo --label todo --parent bot --json
dida tag create --name doing --label doing --parent bot --json
dida tag create --name done --label done --parent bot --json
dida tag create --name freeze --label freeze --parent bot --json
```

### `微信采集`

合并要求上下文任务带 **`微信采集`**（可用 `wechatCaptureTag` 改名）。通常由微信采集流程打上。

| 情况 | 怎么办 |
|------|--------|
| 账号里还没有这个标签 | App 建同名标签，或 `dida tag create --name 微信采集 --label 微信采集 --json` |
| 微信转发任务没有该标签 | 先修好采集/自动打标；否则不会当成可合并对象 |

### 改名整组标记

把 `@bot` / `bot` / `todo`… 改成别的名字时：在 `config.json` **整组一起改**，保证父子一致，然后重启 daemon。旧任务上的旧标签不会自动迁移。

## Bot 写回（摘要）

细则与可粘贴例程提示词见 [webhook.md](webhook.md)。硬规则：

- 保留转发原文 / 聊天上下文，**禁止整段替换** `content`
- 结论用 `\n\n---\n\n` 追加文尾，或写评论；过程写评论
- 叶子改为 `done`，保留 `微信采集`；不要勾选完成
- 指令未明确要求写代码或改仓库时，不要另行拉起编码代理 / 同事 bot 开工
