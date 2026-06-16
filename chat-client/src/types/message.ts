export interface ToolCallInfo {
    name: string;
    args: Record<string, unknown>;
    result?: string;
}

export interface ChatMessage {
    role: "user" | "assistant" | "status" | "system";
    content: string;
    isStreaming?: boolean;
    mode?: string;
    elapsed?: number;
    usage?: Record<string, unknown>;
    toolCalls?: ToolCallInfo[];   // 工具调用步骤
    prompt?: string;              // 实际发给 AI 的提示词（调试用）
}

export type ServerMessage =
    | { type: "chunk"; content: string }
    | { type: "done"; content?: string; mode?: string; elapsed?: number; usage?: Record<string, unknown>; prompt?: string }
    | { type: "error"; content: string }
    | { type: "status"; content: string }
    | { type: "welcome"; content: string; sessionId: string }
    | { type: "system_set"; content: string }
    | { type: "history_cleared"; content: string }
    | { type: "batch_result"; mode: string; elapsed: number; results: { question: string; answer: string }[] }
    | { type: "structured_result"; mode: string; elapsed: number; result: Record<string, unknown> }
    // 工具调用相关
    | { type: "tool_call"; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; content: string };
