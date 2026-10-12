import React from "react";
import {
  QuestionInteraction,
  ToolExecution,
  parseToolOutput,
  type AskUserQuestion,
  type AskUserAnswer,
} from "@modera/ui";
import type { PluginToolRendererProps } from "@modera/plugin-sdk";
import type { Question, Answer } from "../src/questions";

export default function QuestionResult({
  call,
  result,
  state,
  title,
  locale,
  open,
  onOpenChange,
  data,
  busy,
  error,
  act,
}: PluginToolRendererProps) {
  const snapshot = data as { question?: Question; answer?: Answer } | undefined;
  const input = snapshot?.question ?? (call.input as Question);
  const answer =
    snapshot?.answer ??
    (result ? (parseToolOutput(result) as Answer) : undefined);
  const questions: AskUserQuestion[] = (input.questions ?? []).map((q, i) => ({
    ...q,
    id: q.id ?? `q-${i}`,
    freeText: q.freeText || !q.options?.length,
    allowOther: q.allowOther !== false,
    skippable: q.skippable !== false,
    options: q.options?.map((o, j) =>
      typeof o === "string"
        ? { id: `o-${j}`, title: o }
        : { ...o, id: o.id ?? `o-${j}` },
    ),
  }));
  const answers: Record<string, AskUserAnswer> | undefined =
    answer && Array.isArray(answer.responses) && !answer.cancelled
      ? Object.fromEntries(
          (answer.responses ?? []).map((r) => [
            r.questionId,
            {
              questionId: r.questionId,
              selectedIds: r.selectedIds,
              otherText: r.otherText,
              skipped: r.skipped,
            },
          ]),
        )
      : undefined;
  return (
    <ToolExecution
      kind="question"
      name={call.name}
      title={title}
      state={state}
      input={call.input}
      output={answer}
      error={error}
      tone="violet"
      locale={locale}
      open={open}
      onOpenChange={onOpenChange}
      awaitingInput={!answer && state === "running"}
    >
      <QuestionInteraction
        key={call.id}
        questions={questions}
        answers={answers}
        status={
          answer?.cancelled
            ? "cancelled"
            : answers
              ? "answered"
              : state === "running"
                ? "waiting"
                : state === "failed"
                  ? "failed"
                  : "interrupted"
        }
        input={call.input}
        output={answer}
        locale={locale}
        busy={busy}
        error={error}
        onComplete={(values) =>
          act?.("answer", JSON.stringify({ answers: values })) ??
          Promise.resolve(false)
        }
      />
    </ToolExecution>
  );
}
