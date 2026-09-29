/**
 * Live wake against configured Grok Bot webhook (config.json).
 * Creates [setup-dida-bot-test] pair, runs once, keeps main task for bot to mark x-done.
 * Does NOT delete the merged main on success (so bot can act); deletes fragment if still present.
 * Set CLEANUP=1 to delete main after verifying claim.
 */
import { loadAccessToken, loadConfig } from "../src/config.ts";
import { DidaClient } from "../src/dida-api.ts";
import { runMergeAndNotify } from "../src/run.ts";

const PREFIX = "[setup-dida-bot-test]";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const config = loadConfig();
  if (!config.webhookUrl || !config.webhookSecret) {
    throw new Error("config.json missing webhookUrl/webhookSecret");
  }
  const token = loadAccessToken(config.tokenPath);
  const api = new DidaClient(token, config.apiBase);
  const m = config.markers;
  const stamp = Date.now();
  const created: Array<{ projectId: string; id: string }> = [];

  console.log(
    JSON.stringify({
      msg: "live_wake_start",
      webhookHost: new URL(config.webhookUrl).host,
      botMarker: m.botMarker,
      tagTodo: m.tagTodo,
    }),
  );

  const context = await api.createTask({
    title: `${PREFIX} grok-wake context ${stamp}`,
    content: `live wake context for setup-dida-bot-test ${stamp}. Bot may mark x-done after reading.`,
    tags: [m.wechatCaptureTag],
  });
  created.push({ projectId: context.projectId, id: context.id });

  await sleep(800);

  const fragment = await api.createTask({
    title: `${PREFIX} ${m.botMarker} echo hello ${stamp}`,
    content: "",
    tags: [m.wechatCaptureTag],
  });
  created.push({ projectId: fragment.projectId, id: fragment.id });

  await sleep(1500);

  const result = await runMergeAndNotify(config);
  console.log(
    JSON.stringify({
      msg: "live_wake_result",
      ok: result.ok,
      mergedCount: result.mergedCount,
      claimed: result.claimed,
      merges: result.merges,
      pending: result.pending,
      webhook: result.webhook,
      skipped: result.skipped,
      error: result.error,
    }),
  );

  const webhookOk = result.webhook?.work !== undefined && result.webhook.work >= 200 && result.webhook.work < 300;
  const pass = result.ok && result.mergedCount >= 1 && result.claimed >= 1 && webhookOk;
  console.log(JSON.stringify({ msg: "live_wake_assert", pass, webhookOk, workStatus: result.webhook?.work }));

  // Fragment should be deleted by merge; try cleanup leftover fragment only.
  try {
    await api.getTask(fragment.projectId, fragment.id);
    await api.deleteTask(fragment.projectId, fragment.id);
    console.log(JSON.stringify({ msg: "cleanup_orphan_fragment", id: fragment.id }));
  } catch {
    console.log(JSON.stringify({ msg: "fragment_gone_ok", id: fragment.id }));
  }

  if (process.env.CLEANUP === "1") {
    for (const item of created) {
      try {
        await api.deleteTask(item.projectId, item.id);
      } catch {
        /* ignore */
      }
    }
  } else {
    console.log(
      JSON.stringify({
        msg: "left_main_for_bot",
        taskId: result.pending[0]?.taskId ?? context.id,
        title: result.pending[0]?.title ?? context.title,
      }),
    );
  }

  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
