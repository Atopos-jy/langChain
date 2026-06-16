import type { ChatMessage } from "../types/message";

interface Props {
    message: ChatMessage;
}

export function ChatMessage({ message }: Props) {
    const isUser = message.role === "user";
    const isStatus = message.role === "status";
    const isSystem = message.role === "system";

    if (isStatus || isSystem) {
        return (
            <div style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 8,
            }}>
                <div style={{
                    padding: "4px 14px",
                    borderRadius: 12,
                    backgroundColor: "#f0f7ff",
                    border: "1px solid #d0e4f5",
                    fontSize: 13,
                    color: "#555",
                }}>
                    {message.content}
                </div>
            </div>
        );
    }

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

                {/* 调试：显示实际发给 AI 的提示词 */}
                {!isUser && message.prompt && (
                    <details style={{ marginTop: 6, fontSize: 12, color: "#888" }}>
                        <summary style={{ cursor: "pointer", userSelect: "none" }}>
                            🔍 查看实际提示词
                        </summary>
                        <pre style={{
                            margin: "4px 0 0",
                            padding: 8,
                            borderRadius: 6,
                            backgroundColor: "#f5f5f5",
                            fontSize: 11,
                            lineHeight: 1.5,
                            maxHeight: 200,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-all",
                        }}>{message.prompt}</pre>
                    </details>
                )}
            </div>
        </div>
    );
}
