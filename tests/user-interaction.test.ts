import { expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { activate } from "../src";
import { readPluginManifest } from "@modera/plugin-host/testing";

const manifest = readPluginManifest(new URL("..", import.meta.url));
import {
  Questions,
  normalizeQuestion,
} from "../src/questions";
import { ToolExecutor } from "@modera-host/agent-host/src/tool-executor";
import { ToolRegistry } from "@modera-host/agent-host/src/tool-registry";

import { AgentPluginRuntime as PluginRuntime } from "@modera/agent-host";
import { parsePluginManifest } from "@modera-host/plugin-host/src/manifest";
import type { ToolContext } from "@modera/contracts";

const context: ToolContext = {
  sessionId: "s",
  projectId: "p",
  runId: "r",
  signal: new AbortController().signal,
};
const host = {
  pluginId: manifest.id,
  storagePath: "unused",
  signal: new AbortController().signal,
  grantedPermissions: new Set<never>(),
};
it("waits for a real answer, rejects forged/cross-session answers and returns selections plus text once", async () => {
  const registry = new ToolRegistry(),
    approve = vi.fn(async () => true);
  const runtime = new PluginRuntime(
    registry,
    () => true,
    async () => "unused",
  );
  runtime.add({
    manifest: parsePluginManifest(manifest),
    load: async () => ({ activate }),
    readFrontend: async () => ({ body: new Uint8Array(await readFile(new URL("../dist/ui/question-result.js", import.meta.url))), mime: "text/javascript" }),
  });
  await runtime.reconcile(new Set([manifest.id]));
  const executor = new ToolExecutor(registry, approve, new Set());
  const input = {
    question: "选择功能",
    options: ["搜索", "编辑"],
    multiple: true,
  };
  let settled = false;
  const result = executor
    .execute({ id: "q1", name: "ask_user_question", input }, context)
    .then((value) => {
      settled = true;
      return JSON.parse(value);
    });
  const request = {
    id: "modera.interaction.question",
    sessionId: "s",
    toolCallId: "q1",
    locale: "zh-CN",
    tool: { name: "ask_user_question", input },
  };
  try {
    await vi.waitFor(() => expect(executor.activeCall("s", "q1")).toBeTruthy());
    expect(settled).toBe(false);
    expect(approve).not.toHaveBeenCalled();
    expect(await runtime.ui.request(request, context)).toMatchObject({
      live: true,
      data: { question: { question: "选择功能", options: ["搜索", "编辑"], multiple: true } },
      children: [],
    });
    await expect(
      runtime.ui.request(
        {
          ...request,
          action: {
            id: "answer",
            value: JSON.stringify({ selected: [8], text: "" }),
          },
        },
        context,
      ),
    ).rejects.toThrow("selected");
    await expect(
      runtime.ui.request(
        { ...request, action: { id: "cancel" } },
        { ...context, sessionId: "other" },
      ),
    ).rejects.toThrow("pending");
    await runtime.ui.request(
      {
        ...request,
        action: {
          id: "answer",
          value: JSON.stringify({ selected: [0, 1], text: "优先性能" }),
        },
      },
      context,
    );
    expect(await result).toMatchObject({
      answered: true,
      cancelled: false,
      answers: ["搜索", "编辑", "优先性能"],
    });
    await expect(
      runtime.ui.request({ ...request, action: { id: "cancel" } }, context),
    ).rejects.toThrow("pending");
  } finally {
    await runtime.close();
  }
});
it("single choice rejects multiple selections; free-text and cancel are distinct outcomes", async () => {
  const questions = new Questions(host);
  const single = questions.ask(
    { question: "选择", options: ["A", "B"] },
    { ...context, toolCallId: "single" },
  );
  expect(() =>
    questions.respond(
      "single",
      JSON.stringify({ selected: [0, 1], text: "" }),
      context,
    ),
  ).toThrow("one option");
  questions.respond("single", undefined, context, true);
  expect(await single).toMatchObject({
    answered: false,
    cancelled: true,
    answers: [],
  });
  const free = questions.ask(
    { question: "请输入路径" },
    { ...context, toolCallId: "free" },
  );
  questions.respond(
    "free",
    JSON.stringify({ selected: [], text: "src" }),
    context,
  );
  expect(await free).toMatchObject({ answers: ["src"], selectedOptions: [] });
  expect(() => normalizeQuestion({ question: "  " })).toThrow();
  expect(() =>
    normalizeQuestion({ question: "x", options: [" a", "a "] }),
  ).toThrow("Duplicate");
});
it("run cancellation and project disable settle pending questions without approving operations", async () => {
  let enabled = true;
  const registry = new ToolRegistry();
  const runtime = new PluginRuntime(
    registry,
    () => enabled,
    async () => "unused",
  );
  runtime.add({
    manifest,
    load: async () => ({ activate }),
    readFrontend: async () => ({ body: new Uint8Array(await readFile(new URL("../dist/ui/question-result.js", import.meta.url))), mime: "text/javascript" }),
  });
  await runtime.reconcile(new Set([manifest.id]));
  const executor = new ToolExecutor(
    registry,
    async () => {
      throw new Error("No approval expected");
    },
    new Set(),
  );
  try {
    const run = new AbortController();
    const pending = executor.execute(
      {
        id: "cancel",
        name: "ask_user_question",
        input: { question: "等一下" },
      },
      { ...context, signal: run.signal },
    );
    await vi.waitFor(() =>
      expect(executor.activeCall("s", "cancel")).toBeTruthy(),
    );
    run.abort();
    expect(JSON.parse(await pending)).toHaveProperty("error");
    const second = executor.execute(
      {
        id: "disable",
        name: "ask_user_question",
        input: { question: "等一下" },
      },
      context,
    );
    await vi.waitFor(() =>
      expect(executor.activeCall("s", "disable")).toBeTruthy(),
    );
    enabled = false;
    await runtime.reconcile(new Set([manifest.id]));
    expect(JSON.parse(await second)).toHaveProperty("error");
  } finally {
    await runtime.close();
  }
});
it("interaction metadata cannot suppress approval for tools with operation permissions", async () => {
  const registry = new ToolRegistry();
  const execute = vi.fn(async () => "bad");
  registry.register("test", {
    definition: {
      id: "fake",
      title: "fake",
      description: "fake",
      executionKind: "interaction",
      requiredPermissions: ["workspace.write"],
      inputSchema: { type: "object" },
    },
    execute,
  });
  const executor = new ToolExecutor(
    registry,
    async () => true,
    new Set(["workspace.write"]),
  );
  expect(
    JSON.parse(
      await executor.execute({ id: "x", name: "fake", input: {} }, context),
    ).error,
  ).toContain("cannot declare");
  expect(execute).not.toHaveBeenCalled();
});
