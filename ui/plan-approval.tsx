import React, { useState } from "react";
import { ToolExecution, parseToolOutput } from "@modera/ui";
import type { PluginToolRendererProps } from "@modera/plugin-sdk";

export default function PlanApproval({ call, result, state, title, locale, open, onOpenChange, data, busy, act }: PluginToolRendererProps) {
  const output = result ? parseToolOutput(result) as { approved?: boolean } : undefined;
  const approved = output?.approved ?? (data as { approved?: boolean | null } | undefined)?.approved;
  const zh = locale === "zh";
  const [feedback, setFeedback] = useState("");
  const pending = approved == null && state === "running" && !!act;
  return <ToolExecution kind="question" name={call.name} title={title} state={state} input={call.input} output={output} tone="slate" locale={locale} open={open} onOpenChange={onOpenChange} awaitingInput={pending}>
    <div className="modera-plan-approval">
      <div className="modera-plan-approval-heading">
        <div>
          <strong>{zh ? "是否批准执行当前计划？" : "Approve execution of this plan?"}</strong>
          <p>{zh ? "只有明确批准后，AI 才能修改项目文件。" : "Project files can be changed only after explicit approval."}</p>
        </div>
        <span className="modera-plan-approval-status" data-state={approved === true ? "approved" : approved === false ? "revision" : "waiting"} role="status">
          {approved === true ? (zh ? "已批准" : "Approved") : approved === false ? (zh ? "继续规划" : "Planning") : (zh ? "等待审批" : "Waiting")}
        </span>
      </div>
      {pending && <>
        <label className="modera-plan-approval-feedback">
          <span>{zh ? "修改意见" : "Revision feedback"}<small>{zh ? "可选" : "Optional"}</small></span>
          <textarea aria-label={zh ? "计划修改意见" : "Plan revision feedback"} placeholder={zh ? "需要调整计划时，在这里告诉我…" : "Describe any changes to the plan…"} rows={2} maxLength={1000} value={feedback} onChange={event => setFeedback(event.target.value)} />
        </label>
        <div className="modera-plan-approval-footer">
          <span>{zh ? "审批后将在当前任务中继续" : "Continue in this task after your decision"}</span>
          <div className="modera-plan-approval-actions">
            <button type="button" className="modera-plan-approval-continue" disabled={busy} onClick={() => void act?.("continue", feedback)}>{zh ? "继续规划" : "Keep planning"}</button>
            <button type="button" className="modera-plan-approval-approve" disabled={busy} onClick={() => void act?.("approve")}>{zh ? "批准并执行" : "Approve and execute"}</button>
          </div>
        </div>
      </>}
    </div>
  </ToolExecution>;
}
