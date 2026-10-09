import type { PluginContext, ToolContext } from "@modera/plugin-sdk";

export interface Question {
  questions: BatchQuestion[];
}
export interface BatchQuestion {
  id: string;
  title: string;
  options: { id: string; title: string; description?: string }[];
  multiSelect: boolean;
  allowOther: boolean;
  skippable: boolean;
  freeText: boolean;
  layout?: "inline" | "stacked";
  chipPosition?: "left" | "right";
  otherPlaceholder?: string;
  freeTextPlaceholder?: string;
  freeTextMultiline?: boolean;
  nextLabel?: string;
}
export interface Answer {
  question: string;
  answered: boolean;
  cancelled: boolean;
  selectedOptions: string[];
  customAnswer: string;
  answers: string[];
  responses: {
    questionId: string;
    question: string;
    selectedIds: string[];
    selectedOptions: string[];
    otherText: string;
    skipped: boolean;
  }[];
}
interface Pending {
  question: Question;
  finish(answer: Answer): void;
}
export function normalizeQuestion(raw: unknown): Question {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    Object.keys(raw).some((key) => key !== "questions")
  )
    throw new Error(
      "Use the questions array; legacy question/options/multiple is not supported",
    );
  const list = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(list) || !list.length || list.length > 12)
    throw new Error("Provide 1 to 12 questions");
  const questions = list.map((value, index): BatchQuestion => {
    if (!value || typeof value !== "object")
      throw new Error("Invalid question");
    const q = value as Record<string, unknown>;
    const string = (value: unknown, max: number) => {
      if (typeof value !== "string" || !value.trim() || value.length > max)
        throw new Error("Invalid question text or ID");
      return value.trim();
    };
    for (const name of [
      "multiSelect",
      "allowOther",
      "skippable",
      "freeText",
      "freeTextMultiline",
    ])
      if (q[name] !== undefined && typeof q[name] !== "boolean")
        throw new Error(`Invalid ${name}`);
    if (
      q.layout !== undefined &&
      !["inline", "stacked"].includes(String(q.layout))
    )
      throw new Error("Invalid layout");
    if (
      q.chipPosition !== undefined &&
      !["left", "right"].includes(String(q.chipPosition))
    )
      throw new Error("Invalid chipPosition");
    const rawOptions = q.options ?? [];
    if (!Array.isArray(rawOptions) || rawOptions.length > 16)
      throw new Error("Invalid options");
    const options = rawOptions.map((option, i) => {
      const o =
        typeof option === "string"
          ? { title: option }
          : (option as Record<string, unknown>);
      if (!o || typeof o !== "object") throw new Error("Invalid options");
      return {
        id: o.id === undefined ? `o-${i}` : string(o.id, 100),
        title: string(o.title, 200),
        ...(o.description === undefined
          ? {}
          : { description: string(o.description, 1000) }),
      };
    });
    if (new Set(options.map((o) => o.id)).size !== options.length)
      throw new Error("Duplicate option IDs");
    const freeText = q.freeText === true || !options.length;
    return {
      id: q.id === undefined ? `q-${index}` : string(q.id, 100),
      title: string(q.title, 2000),
      options: freeText ? [] : options,
      multiSelect: q.multiSelect === true,
      allowOther: q.allowOther !== false,
      skippable: q.skippable !== false,
      freeText,
      ...(q.layout === undefined
        ? {}
        : { layout: q.layout as BatchQuestion["layout"] }),
      ...(q.chipPosition === undefined
        ? {}
        : { chipPosition: q.chipPosition as BatchQuestion["chipPosition"] }),
      ...(q.freeTextMultiline === undefined
        ? {}
        : { freeTextMultiline: q.freeTextMultiline as boolean }),
      ...Object.fromEntries(
        ["otherPlaceholder", "freeTextPlaceholder", "nextLabel"]
          .filter((key) => q[key] !== undefined)
          .map((key) => [key, string(q[key], 200)]),
      ),
    };
  });
  if (new Set(questions.map((q) => q.id)).size !== questions.length)
    throw new Error("Duplicate question IDs");
  if (JSON.stringify(questions).length > 90000)
    throw new Error("Questions exceed the total text budget");
  return { questions };
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
        if (noticeId)
          void this.host.notifications
            ?.update(
              noticeId,
              { pending: false },
              { projectId: context.projectId },
            )
            .catch((error) =>
              console.warn("Question notification update failed", error),
            );
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
      if (!settled)
        void this.host.notifications
          ?.publish(
            {
              key: `question:${context.toolCallId}`,
              title: "等待你的回答",
              body: `${question.questions.length} 个问题：${question.questions[0]!.title}`,
              level: "info",
              pending: true,
              target: { type: "conversation", sessionId: context.sessionId },
            },
            context,
          )
          .then((item) => {
            noticeId = item.id;
            if (settled)
              return this.host.notifications?.update(
                item.id,
                { pending: false },
                { projectId: context.projectId },
              );
          })
          .catch((error) =>
            console.warn("Question notification failed", error),
          );
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
    if (!value || value.length > 40000) throw new Error("Invalid answer");
    {
      const input = JSON.parse(value) as { answers?: Record<string, unknown> };
      if (
        !input?.answers ||
        typeof input.answers !== "object" ||
        Array.isArray(input.answers)
      )
        throw new Error("Invalid answers");
      const questions = item.question.questions;
      if (
        Object.keys(input.answers).length !== questions.length ||
        Object.keys(input.answers).some(
          (id) => !questions.some((q) => q.id === id),
        )
      )
        throw new Error("Answer every question or skip it");
      const responses = questions.map((q) => {
        const raw = input.answers![q.id] as {
          questionId?: unknown;
          selectedIds?: unknown;
          otherText?: unknown;
          skipped?: unknown;
        };
        if (
          !raw ||
          raw.questionId !== q.id ||
          (raw.skipped !== undefined && typeof raw.skipped !== "boolean")
        )
          throw new Error("Invalid question answer");
        const selected = raw.selectedIds;
        if (
          !Array.isArray(selected) ||
          selected.some(
            (id) =>
              typeof id !== "string" || !q.options.some((o) => o.id === id),
          ) ||
          new Set(selected).size !== selected.length
        )
          throw new Error("Invalid selected options");
        if (!q.multiSelect && selected.length > 1)
          throw new Error("Choose one option");
        if (
          raw.otherText !== undefined &&
          (typeof raw.otherText !== "string" || raw.otherText.length > 1000)
        )
          throw new Error("Invalid custom answer");
        const text = ((raw.otherText ?? "") as string).trim();
        if (text && !q.allowOther && !q.freeText)
          throw new Error("Custom answer not allowed");
        if (raw.skipped && (!q.skippable || selected.length || text))
          throw new Error(
            "Question cannot be skipped or skipped answer has content",
          );
        if (!raw.skipped && !selected.length && !text)
          throw new Error("Answer required");
        return {
          questionId: q.id,
          question: q.title,
          selectedIds: selected as string[],
          selectedOptions: selected.map(
            (id) => q.options.find((o) => o.id === id)!.title,
          ),
          otherText: text,
          skipped: raw.skipped === true,
        };
      });
      item.finish({
        question: item.question.questions.map((q) => q.title).join("\n"),
        answered: responses.some((r) => !r.skipped),
        cancelled: false,
        selectedOptions: responses.flatMap((r) => r.selectedOptions),
        customAnswer: responses
          .map((r) => r.otherText)
          .filter(Boolean)
          .join("\n"),
        answers: responses.flatMap((r) => [
          ...r.selectedOptions,
          ...(r.otherText ? [r.otherText] : []),
        ]),
        responses,
      });
      return;
    }
  }
  private cancelled(question: Question): Answer {
    return {
      question: question.questions.map((q) => q.title).join("\n"),
      answered: false,
      cancelled: true,
      selectedOptions: [],
      customAnswer: "",
      answers: [],
      responses: [],
    };
  }
}
