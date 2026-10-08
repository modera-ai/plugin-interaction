import React, { useState } from "react";
import { ToolExecution, parseToolOutput } from "@modera/ui";
import type { PluginToolRendererProps } from "@modera/plugin-sdk";

export default function PlanApproval({ call, result, state, title, locale, open, onOpenChange, data, busy, act }: PluginToolRendererProps) {
  const output = result ? parseToolOutput(result) as { approved?: boolean } : undefined;
  const approved = output?.approved ?? (data as { approved?: boolean | null } | undefined)?.approved;
  const zh = locale === "zh";
  const [feedback, setFeedback] = useState("");
  return <ToolExecution kind="question" name={call.name} title={title} state={state} input={call.input} output={output} tone="violet" locale={locale} open={open} onOpenChange={onOpenChange} awaitingInput={state === "running" && approved == null && !!act}>
    <div style={{ padding: "12px 16px" }}>
      <strong>{zh ? "是否批准执行当前计划？" : "Approve execution of this plan?"}</strong>
      <p>{approved === true ? (zh ? "已批准执行" : "Approved for execution") : approved === false ? (zh ? "继续规划" : "Continue planning") : (zh ? "只有明确批准后，AI 才能修改项目文件。" : "Project files can be changed only after explicit approval.")}</p>
      {approved == null && state === "running" && act && <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <textarea aria-label={zh ? "计划修改意见" : "Plan revision feedback"} placeholder={zh ? "可填写希望如何修改计划" : "Optional plan revision feedback"} maxLength={1000} value={feedback} onChange={event => setFeedback(event.target.value)} />
        <button type="button" disabled={busy} onClick={() => void act("continue", feedback)}>{zh ? "继续规划" : "Keep planning"}</button>
        <button type="button" disabled={busy} onClick={() => void act("approve")}>{zh ? "批准并执行" : "Approve and execute"}</button>
      </div>}
    </div>
  </ToolExecution>;
}
