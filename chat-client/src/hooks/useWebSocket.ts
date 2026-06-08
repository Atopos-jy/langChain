import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage, ServerMessage } from "../types/message";

export type InvokeMode = "stream" | "invoke" | "batch" | "structured";

export function useWebSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [currentMode, setCurrentMode] = useState<InvokeMode>("stream");
    const wsRef = useRef<WebSocket | null>(null);

    // 连接 WebSocket
    useEffect(() => {
        const ws = new WebSocket("ws://localhost:8080");
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("✅ WebSocket 已连接");
            setIsConnected(true);
        };

        ws.onclose = () => {
            console.log("🔌 WebSocket 已断开");
            setIsConnected(false);
        };

        ws.onmessage = (event) => {
            const data: ServerMessage = JSON.parse(event.data);

            switch (data.type) {
                case "chunk":
                    // 追加到正在流式输出的最后一条 AI 消息
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === "assistant" && last.isStreaming) {
                            updated[updated.length - 1] = {
                                ...last,
                                content: last.content + data.content,
                            };
                        }
                        return updated;
                    });
                    break;

                case "done":
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === "assistant" && last.isStreaming) {
                            updated[updated.length - 1] = {
                                ...last,
                                isStreaming: false,
                                mode: data.mode,
                                elapsed: data.elapsed,
                                usage: data.usage,
                            };
                        }
                        return updated;
                    });
                    break;

                case "error":
                    console.error("❌ 服务器错误:", data.content);
                    break;

                case "welcome":
                    console.log("👋 欢迎消息, 会话 ID:", data.sessionId);
                    break;

                case "batch_result": {
                    const text = data.results
                        .map((r, i) => `【问题${i + 1}】${r.question}\n\n${r.answer}`)
                        .join("\n\n---\n\n");
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === "assistant" && last.isStreaming) {
                            updated[updated.length - 1] = {
                                ...last,
                                content: text,
                                isStreaming: false,
                                mode: "batch",
                                elapsed: data.elapsed,
                            };
                        }
                        return updated;
                    });
                    break;
                }

                case "structured_result": {
                    const text = "```json\n" + JSON.stringify(data.result, null, 2) + "\n```";
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === "assistant" && last.isStreaming) {
                            updated[updated.length - 1] = {
                                ...last,
                                content: text,
                                isStreaming: false,
                                mode: "structured",
                                elapsed: data.elapsed,
                            };
                        }
                        return updated;
                    });
                    break;
                }
            }
        };

        ws.onerror = (err) => {
            console.error("❌ WebSocket 错误:", err);
        };

        return () => ws.close();
    }, []);

    const sendMessage = useCallback((content: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.error("WebSocket 未连接");
            return;
        }

        // 1. 先把用户消息加到列表
        setMessages((prev) => [...prev, { role: "user", content }]);

        // 2. 创建一个空白 AI 消息占位（batch 和 structured 也用它显示结果）
        setMessages((prev) => [...prev, { role: "assistant", content: "", isStreaming: true }]);

        // 3. 带上模式一起发送
        wsRef.current.send(JSON.stringify({ type: "message", content, mode: currentMode }));
    }, [currentMode]);

    const clearMessages = useCallback(() => {
        setMessages([]);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "clear" }));
        }
    }, []);

    const sendSystemPrompt = useCallback((content: string) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: "system", content }));
        }
    }, []);

    return { isConnected, messages, sendMessage, clearMessages, sendSystemPrompt, currentMode, setCurrentMode };
}
