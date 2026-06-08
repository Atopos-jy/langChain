export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    isStreaming?: boolean;
    // 非流式模式的额外信息
    mode?: string;
    elapsed?: number;
    usage?: Record<string, unknown>;
}

export type ServerMessage =
    | { type: "chunk"; content: string }
    | { type: "done"; content?: string; mode?: string; elapsed?: number; usage?: Record<string, unknown> }
    | { type: "error"; content: string }
    | { type: "welcome"; content: string; sessionId: string }
    | { type: "batch_result"; mode: string; elapsed: number; results: { question: string; answer: string }[] }
    | { type: "structured_result"; mode: string; elapsed: number; result: Record<string, unknown> };
