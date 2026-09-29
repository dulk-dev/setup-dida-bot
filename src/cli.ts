#!/usr/bin/env node
import { loadConfig, saveRawConfigPatch } from "./config.ts";
import { runMergeAndNotify } from "./run.ts";
import { readStatus } from "./store.ts";
import { startUiServer } from "./ui-server.ts";

function usage(): never {
  console.log(`setup-dida-bot — merge WeChat-split Dida tasks and wake a Grok Bot

Usage:
  npm run once     # run merge+claim once
  npm run daemon   # poll every intervalSeconds
  npm run status   # print data/status.json
  npm run ui       # localhost status + settings page

  tsx src/cli.ts once | daemon | status | ui
`);
  process.exit(1);
}

async function cmdOnce(): Promise<void> {
  const config = loadConfig();
  const result = await runMergeAndNotify(config);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok && !result.locked && result.error !== "disabled") {
    process.exitCode = 1;
  }
}

async function cmdDaemon(): Promise<void> {
  let stopping = false;
  const onStop = () => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ msg: "daemon_stopping" }));
  };
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);

  console.log(
    JSON.stringify({
      msg: "daemon_start",
      intervalSeconds: loadConfig().intervalSeconds,
    }),
  );

  while (!stopping) {
    const config = loadConfig();
    if (!config.enabled) {
      console.log(JSON.stringify({ msg: "daemon_disabled_skip" }));
    } else {
      try {
        const result = await runMergeAndNotify(config);
        console.log(
          JSON.stringify({
            msg: "daemon_tick",
            ok: result.ok,
            merged: result.mergedCount,
            claimed: result.claimed,
            error: result.error,
          }),
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            msg: "daemon_tick_error",
            error: error instanceof Error ? error.message : "unknown",
          }),
        );
      }
    }
    const waitMs = Math.max(15, loadConfig().intervalSeconds) * 1000;
    const step = 500;
    let waited = 0;
    while (!stopping && waited < waitMs) {
      await new Promise((r) => setTimeout(r, step));
      waited += step;
    }
  }
}

function cmdStatus(): void {
  const config = loadConfig();
  const status = readStatus(config.dataDir);
  if (!status) {
    console.log(
      JSON.stringify({
        ok: false,
        error: "no_status_yet",
        dataDir: config.dataDir,
        markers: {
          botMarker: config.markers.botMarker,
          notMarker: config.markers.notMarker,
          tagTodo: config.markers.tagTodo,
        },
        intervalSeconds: config.intervalSeconds,
        webhookConfigured: config.webhookUrl.length > 0,
        enabled: config.enabled,
      }, null, 2),
    );
    return;
  }
  console.log(JSON.stringify(status, null, 2));
}

async function cmdUi(): Promise<void> {
  const config = loadConfig();
  await startUiServer(config, {
    onUpdate: (patch) => {
      saveRawConfigPatch(config.configPath, patch);
    },
  });
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "once";
  switch (cmd) {
    case "once":
      await cmdOnce();
      break;
    case "daemon":
      await cmdDaemon();
      break;
    case "status":
      cmdStatus();
      break;
    case "ui":
      await cmdUi();
      break;
    case "help":
    case "-h":
    case "--help":
      usage();
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
