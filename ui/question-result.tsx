import React from "react";
import { AgentQuestion, ToolExecution, parseToolOutput, type AgentQuestionProps } from "@modera/ui";
import type { PluginToolRendererProps } from "@modera/plugin-sdk";

export default function QuestionResult({ call, result, state, title, locale, open, onOpenChange, data, busy, error, act }: PluginToolRendererProps) {
  const snapshot = data as { question?: { question: string; options: string[]; multiple: boolean }; answer?: AgentQuestionProps["answer"] } | undefined;
  const question = snapshot?.question ?? call.input as { question: string; options?: string[]; multiple?: boolean };
  const answer = snapshot?.answer ?? (result ? parseToolOutput(result) as AgentQuestionProps["answer"] : undefined);
  return <ToolExecution kind="question" name={call.name} title={title} target={question.question} state={state} input={call.input} output={answer} tone="violet" locale={locale} open={open} onOpenChange={onOpenChange} awaitingInput={state === "running" && !answer && !!act}>
    <AgentQuestion key={call.id} {...question} answer={answer} busy={busy || !act || state !== "running"} error={error} locale={locale} onSubmit={(value) => act?.("answer", JSON.stringify(value)) ?? Promise.resolve(false)} onCancel={() => act?.("cancel") ?? Promise.resolve(false)} />
  </ToolExecution>;
}
