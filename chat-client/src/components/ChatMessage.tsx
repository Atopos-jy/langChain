import type { ChatMessage } from "../types/message";

interface Props {
    message: ChatMessage;
}

export function ChatMessage({ message }: Props) {
    const isUser = message.role === "user";

    return (
        <div style={{
            display: "flex",
            justifyContent: isUser ? "flex-end" : "flex-start",
            marginBottom: 12,
        }}>
            <div style={{
                maxWidth: "70%",
                padding: "10px 16px",
                borderRadius: 18,
                backgroundColor: isUser ? "#007aff" : "#e9e9eb",
                color: isUser ? "#fff" : "#000",
            }}>
                {message.content}
                {message.isStreaming && <span style={{ opacity: 0.7 }}>|</span>}
            </div>
        </div>
    );
}
