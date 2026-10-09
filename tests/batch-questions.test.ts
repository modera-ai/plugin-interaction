import { expect, it } from "vitest";
import { normalizeQuestion, Questions } from "../src/questions";

const context = {
  sessionId: "chat",
  projectId: "project",
  runId: "run",
  signal: new AbortController().signal,
};
const host = {
  pluginId: "modera.interaction",
  storagePath: "unused",
  signal: new AbortController().signal,
  grantedPermissions: new Set<never>(),
};
const batch = {
  questions: [
    {
      id: "choice",
      title: "Choose",
      options: [
        { id: "a", title: "A", description: "Fast" },
        { id: "b", title: "B" },
      ],
      multiSelect: true,
      allowOther: false,
      skippable: false,
    },
    { id: "text", title: "Details", freeText: true, skippable: false },
    { id: "optional", title: "Optional", options: ["Yes", "No"] },
  ],
};
const answers = {
  choice: { questionId: "choice", selectedIds: ["a", "b"] },
  text: { questionId: "text", selectedIds: [], otherText: "Details from user" },
  optional: { questionId: "optional", selectedIds: [], skipped: true },
};

it("keeps a batch pending until every answer is valid and returns stable identities", async () => {
  const questions = new Questions(host);
  let settled = false;
  const pending = questions
    .ask(batch, { ...context, toolCallId: "batch" })
    .then((answer) => {
      settled = true;
      return answer;
    });
  const respond = (input: unknown, ctx = context) =>
    questions.respond("batch", JSON.stringify({ answers: input }), ctx);
  expect(() => respond({ choice: answers.choice })).toThrow("every question");
  expect(() =>
    respond({ ...answers, text: { ...answers.text, otherText: "" } }),
  ).toThrow("required");
  expect(() =>
    respond({ ...answers, choice: { ...answers.choice, otherText: "no" } }),
  ).toThrow("not allowed");
  expect(() =>
    respond({
      ...answers,
      choice: { ...answers.choice, selectedIds: [], skipped: true },
    }),
  ).toThrow("cannot be skipped");
  expect(() =>
    respond({
      ...answers,
      choice: { ...answers.choice, selectedIds: ["forged"] },
    }),
  ).toThrow("selected options");
  expect(() => respond(answers, { ...context, projectId: "other" })).toThrow(
    "pending",
  );
  expect(settled).toBe(false);
  respond(answers);
  expect(await pending).toMatchObject({
    answered: true,
    cancelled: false,
    responses: [
      {
        questionId: "choice",
        selectedIds: ["a", "b"],
        selectedOptions: ["A", "B"],
        skipped: false,
      },
      { questionId: "text", otherText: "Details from user", skipped: false },
      { questionId: "optional", skipped: true },
    ],
  });
  expect(() => respond(answers)).toThrow("pending");
});
it("distinguishes all skipped questions from cancelling the flow", async () => {
  const questions = new Questions(host);
  const pending = questions.ask(
    { questions: [{ title: "Optional" }] },
    { ...context, toolCallId: "skip" },
  );
  questions.respond(
    "skip",
    JSON.stringify({
      answers: { "q-0": { questionId: "q-0", selectedIds: [], skipped: true } },
    }),
    context,
  );
  expect(await pending).toMatchObject({
    answered: false,
    cancelled: false,
    responses: [{ skipped: true }],
  });
  const controller = new AbortController();
  const cancelled = questions.ask(batch, {
    ...context,
    toolCallId: "abort",
    signal: controller.signal,
  });
  controller.abort();
  expect(await cancelled).toMatchObject({ answered: false, cancelled: true });
});
it("validates question IDs, option IDs, field types and single choice", async () => {
  expect(() => normalizeQuestion({ questions: [] })).toThrow();
  expect(() =>
    normalizeQuestion({
      questions: [
        { id: "x", title: "A" },
        { id: "x", title: "B" },
      ],
    }),
  ).toThrow("Duplicate question");
  expect(() =>
    normalizeQuestion({
      questions: [
        {
          title: "A",
          options: [
            { id: "x", title: "A" },
            { id: "x", title: "B" },
          ],
        },
      ],
    }),
  ).toThrow("Duplicate option");
  expect(() =>
    normalizeQuestion({ questions: [{ title: "A", skippable: "false" }] }),
  ).toThrow("skippable");
  const questions = new Questions(host);
  const pending = questions.ask(
    { questions: [{ title: "Choose", options: ["A", "B"] }] },
    { ...context, toolCallId: "single" },
  );
  expect(() =>
    questions.respond(
      "single",
      JSON.stringify({
        answers: { "q-0": { questionId: "q-0", selectedIds: ["o-0", "o-1"] } },
      }),
      context,
    ),
  ).toThrow("one option");
  questions.respond("single", undefined, context, true);
  await pending;
});

it("rejects the retired single-question format and mixed inputs", async () => {
  for (const input of [
    { question: "Old format", options: ["A"], multiple: false },
    { questions: [{ title: "New format" }], question: "Old format" },
  ]) {
    expect(() => normalizeQuestion(input)).toThrow("questions array");
    await expect(
      new Questions(host).ask(input, { ...context, toolCallId: "legacy" }),
    ).rejects.toThrow("questions array");
  }
});
