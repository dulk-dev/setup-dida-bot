# 开机自启与保活

面向 **Grok Bot 云端电脑**。`npm run daemon` 是一个常驻进程（醒 → 跑一轮 → 睡）。机器重启或被换成另一台之后，进程消失，轮询停止。

这类环境通常**没有** systemd，也**没有** crontab，开机不会自己把进程拉回来。

## 拉起

在仓库根目录执行：

```bash
bash scripts/ensure-daemon.sh
# 或
npm run ensure
```

| 情况 | 结果 |
|------|------|
| `data/daemon.pid` 里的进程还在 | 打印 `already_running pid=…`，退出 0 |
| 没有 `node_modules` 或 `node_modules/.bin/tsx` | 先 `npm install` |
| 没有 `config.json` | 打印 `missing config.json`，退出 1 |
| 否则 | `nohup` 用仓库里的 `tsx` 跑 `src/cli.ts daemon`，打印 `started pid=…` |

标准输出用来区分「已在跑」和「这次拉起」。日志追加到 `data/daemon.log`。脚本可以反复执行。

`node` 和 `npm` 必须在 `PATH` 上。不要把某一台机器的 Node 绝对路径写进脚本；调用环境的 `PATH` 更窄时，在调用处自己前置即可。

`config.json` 只留在本机（从 `config.example.json` 复制）。不要把 webhook URL 或 secret 写进仓库。

## 可选：每天补跑

云端电脑换过或重启后，在你执行上面的脚本之前，轮询是空的。可以在 Grok Bot 里另建一条例程，每天跑 **1～2 次** `scripts/ensure-daemon.sh`（或 `npm run ensure`）当作补漏。

健康时标准输出是 `already_running pid=…`。例程据此保持安静，不要发通知。只有启动失败、进程起不来时才需要人看。

这只是补漏，不是唯一保活手段，也不能填上「机器刚换完、例程还没到点」的空档。例程在 Grok Bot 里自己建。不要把 webhook URL、secret 或例程 id 写进仓库或本文。

若仓库跑在你自己的 Linux 上且有 systemd，可以用 user unit 在登录时执行 `scripts/ensure-daemon.sh`；云端电脑通常没有，不必准备。
