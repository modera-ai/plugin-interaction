import { expect, test, vi } from "vitest";
import type { PluginContext } from "@modera/plugin-sdk";
import { Questions } from "../src/questions";

function fixture() {
  const publish = vi.fn(async () => ({ id: "notice" }));
  const update = vi.fn(async () => {});
  const controller = new AbortController();
  const handlers = new Map<
    string,
    (values: { selected: string[]; text: string }) => void | Promise<void>
  >();
  const onAction = vi.fn(
    (
      id: string,
      handler: (values: {
        selected: string[];
        text: string;
      }) => void | Promise<void>,
    ) => {
      handlers.set(id, handler);
      return () => {
        handlers.delete(id);
      };
    },
  );
  const host = {
    signal: controller.signal,
    notifications: { publish, update, onAction },
  } as unknown as PluginContext;
  const context = {
    projectId: "project",
    sessionId: "session",
    runId: "run",
    toolCallId: "call",
    signal: new AbortController().signal,
  };
  return {
    questions: new Questions(host),
    publish,
    update,
    controller,
    context,
    handlers,
  };
}
test("a real answer ends its pending notice without going through notification approval", async () => {
  const { questions, publish, update, context } = fixture();
  const answer = questions.ask(
    { questions: [{ title: "Choose", options: ["One"] }] },
    context,
  );
  await Promise.resolve();
  questions.respond(
    "call",
    JSON.stringify({
      answers: {
        "q-0": { questionId: "q-0", selectedIds: ["o-0"], otherText: "" },
      },
    }),
    context,
  );
  await expect(answer).resolves.toMatchObject({
    answered: true,
    answers: ["One"],
  });
  expect(publish).toHaveBeenCalledWith(
    expect.objectContaining({
      pending: true,
      target: { type: "conversation", sessionId: "session" },
    }),
    context,
  );
  expect(update).toHaveBeenCalledWith(
    "notice",
    { pending: false },
    { projectId: "project" },
  );
});
test("notifications only link to the conversation; answers and cancellation use the chat UI", async () => {
  const { questions, context, handlers, publish } = fixture();
  const result = questions.ask(
    {
      questions: [
        { title: "Choose", options: ["One", "Two"], multiSelect: true },
      ],
    },
    context,
  );
  expect(publish.mock.calls[0]?.[0]).not.toHaveProperty("interaction");
  expect(handlers.size).toBe(0);
  questions.respond("call", undefined, context, true);
  await expect(result).resolves.toMatchObject({
    answered: false,
    cancelled: true,
  });
});
test("cancellation during asynchronous publication still settles the eventual notice", async () => {
  const { questions, publish, update, controller, context } = fixture();
  let finishPublish!: (item: { id: string }) => void;
  publish.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPublish = resolve;
      }),
  );
  const answer = questions.ask({ questions: [{ title: "Choose" }] }, context);
  controller.abort();
  await expect(answer).resolves.toMatchObject({
    cancelled: true,
    answered: false,
  });
  finishPublish({ id: "notice" });
  await Promise.resolve();
  await Promise.resolve();
  expect(update).toHaveBeenCalledWith(
    "notice",
    { pending: false },
    { projectId: "project" },
  );
});
