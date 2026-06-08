export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    isStreaming?: boolean;
}

export type ServerMessage =
    | { type: "chunk"; content: string }
    | { type: "done"; content: string }
    | { type: "error"; content: string }
    | { type: "welcome"; content: string; sessionId: string };
