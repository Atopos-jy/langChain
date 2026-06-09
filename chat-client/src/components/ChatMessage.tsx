import type { ChatMessage } from "../types/message";

interface Props {
    message: ChatMessage;
}

export function ChatMessage({ message }: Props) {
    const isUser = message.role === "user";

    return (
        <div
            style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
                marginBottom: 12,
            }}
        >
            <div style={{ maxWidth: "70%" }}>
                {/* 工具调用步骤 */}
                {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                        {message.toolCalls.map((tc, i) => (
                            <div key={i} style={{
                                padding: "8px 12px",
                                borderRadius: 8,
                                backgroundColor: "#f0f5ff",
                                border: "1px solid #d6e4ff",
                                marginBottom: 4,
                                fontSize: 13,
                            }}>
                                <div style={{ fontWeight: 600, color: "#1d39c4" }}>
                                    🔧 调用工具: {tc.name}
                                </div>
                                <div style={{ color: "#666", marginTop: 2 }}>
                                    参数: {JSON.stringify(tc.args)}
                                </div>
                                {tc.result && (
                                    <div style={{ color: "#389e0d", marginTop: 2 }}>
                                        ✅ 结果: {tc.result}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                <div style={{
                    padding: "10px 16px",
                    borderRadius: 18,
                    backgroundColor: isUser ? "#007aff" : "#e9e9eb",
                    color: isUser ? "#fff" : "#000",
                    whiteSpace: "pre-wrap",
                    fontFamily: message.mode === "structured" ? "monospace" : "inherit",
                    fontSize: message.mode === "structured" ? 13 : 16,
                }}>
                    {message.content}
                    {message.isStreaming && <span style={{ opacity: 0.7 }}>|</span>}
                </div>
            </div>
        </div>
    );
}
