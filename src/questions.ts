import type { PluginContext, ToolContext } from "@modera/plugin-sdk";

export interface Question {
  question: string;
  options: string[];
  multiple: boolean;
}
export interface Answer {
  question: string;
  answered: boolean;
  cancelled: boolean;
  selectedOptions: string[];
  customAnswer: string;
  answers: string[];
}
interface Pending {
  question: Question;
  finish(answer: Answer): void;
}
export function normalizeQuestion(raw: unknown): Question {
  const input = raw as {
    question?: unknown;
    options?: unknown;
    multiple?: unknown;
  };
  if (
    typeof input?.question !== "string" ||
    !input.question.trim() ||
    input.question.length > 2000
  )
    throw new Error("Question required (max 2000 characters)");
  const options = input.options ?? [];
  if (
    !Array.isArray(options) ||
    options.length > 8 ||
    options.some(
      (option) =>
        typeof option !== "string" || !option.trim() || option.length > 200,
    )
  )
    throw new Error("Invalid options");
  const normalized = options.map((option) => (option as string).trim());
  if (new Set(normalized).size !== normalized.length)
    throw new Error("Duplicate options");
  return {
    question: input.question.trim(),
    options: normalized,
    multiple: input.multiple === true,
  };
}
/** Only UI actions can settle these promises; model arguments never contain answers. */
export class Questions {
  private pending = new Map<string, Pending>();
  private finished = new Map<string, { question: Question; answer: Answer }>();
  constructor(private host: PluginContext) {}
  private key(callId: string, context: ToolContext) {
    return JSON.stringify([context.projectId, context.sessionId, callId]);
  }
  snapshot(
    callId: string,
    context: ToolContext,
  ): { question: Question; answer?: Answer } | undefined {
    const key = this.key(callId, context);
    const item = this.pending.get(key);
    return item ? { question: item.question } : this.finished.get(key);
  }
  async ask(raw: unknown, context: ToolContext): Promise<Answer> {
    const question = normalizeQuestion(raw);
    const signal = AbortSignal.any([context.signal, this.host.signal]);
    signal.throwIfAborted();
    if (!context.toolCallId) throw new Error("Host tool call ID required");
    const key = this.key(context.toolCallId, context);
    if (
      this.pending.size >= 8 ||
      this.pending.has(key) ||
      this.finished.has(key)
    )
      throw new Error("Question already exists or capacity reached");
    let noticeId: string | undefined;
    let settled = false;
    return new Promise((resolve) => {
      const finish = (answer: Answer) => {
        if (!this.pending.delete(key)) return;
        settled = true;
        if (noticeId) void this.host.notifications?.update(noticeId, { pending: false }, { projectId: context.projectId }).catch(error => console.warn("Question notification update failed", error));
        signal.removeEventListener("abort", cancelled);
        if (this.finished.size >= 32)
          this.finished.delete(this.finished.keys().next().value!);
        this.finished.set(key, { question, answer });
        this.host.invalidateUi?.(context.sessionId);
        resolve(answer);
      };
      const cancelled = () => finish(this.cancelled(question));
      this.pending.set(key, { question, finish });
      signal.addEventListener("abort", cancelled, { once: true });
      this.host.invalidateUi?.(context.sessionId);
      if (signal.aborted) cancelled();
      if (!settled) void this.host.notifications?.publish({ key: `question:${context.toolCallId}`, title: "等待你的回答", body: question.question,
        level: "info", pending: true, target: { type: "conversation", sessionId: context.sessionId } }, context)
        .then(item => { noticeId = item.id; if (settled) return this.host.notifications?.update(item.id, { pending: false }, { projectId: context.projectId }); })
        .catch(error => console.warn("Question notification failed", error));
    });
  }
  respond(
    callId: string,
    value: string | undefined,
    context: ToolContext,
    cancel = false,
  ) {
    context.signal.throwIfAborted();
    this.host.signal.throwIfAborted();
    const item = this.pending.get(this.key(callId, context));
    if (!item)
      throw new Error("Question is no longer pending in this conversation");
    if (cancel) {
      item.finish(this.cancelled(item.question));
      return;
    }
    if (!value || value.length > 4000) throw new Error("Invalid answer");
    const input = JSON.parse(value) as { selected?: unknown; text?: unknown };
    if (
      !Array.isArray(input.selected) ||
      input.selected.length > 8 ||
      input.selected.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0 ||
          index >= item.question.options.length,
      ) ||
      new Set(input.selected).size !== input.selected.length
    )
      throw new Error("Invalid selected options");
    if (!item.question.multiple && input.selected.length > 1)
      throw new Error("Choose one option");
    if (typeof input.text !== "string" || input.text.length > 1000)
      throw new Error("Invalid custom answer");
    const text = input.text.trim();
    if (!text && !input.selected.length) throw new Error("Answer required");
    const selectedOptions = input.selected.map(
      (index) => item.question.options[index as number]!,
    );
    item.finish({
      question: item.question.question,
      answered: true,
      cancelled: false,
      selectedOptions,
      customAnswer: text,
      answers: [...selectedOptions, ...(text ? [text] : [])],
    });
  }
  private cancelled(question: Question): Answer {
    return {
      question: question.question,
      answered: false,
      cancelled: true,
      selectedOptions: [],
      customAnswer: "",
      answers: [],
    };
  }
}
