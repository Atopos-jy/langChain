import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage, ServerMessage, ToolCallInfo } from "../types/message";

export type InvokeMode = "stream" | "invoke" | "batch" | "structured" | "tool" | "deep";

const WS_URL = "ws://localhost:8080";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 10000;

export function useWebSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [currentMode, setCurrentMode] = useState<InvokeMode>("stream");
    const [status, setStatus] = useState<string | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const welcomeShownRef = useRef(false);
    const toolCallsRef = useRef<ToolCallInfo[]>([]);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);

    const connect = useCallback(() => {
        // 清理旧连接
        if (wsRef.current) {
            wsRef.current.onopen = null;
            wsRef.current.onclose = null;
            wsRef.current.onmessage = null;
            wsRef.current.onerror = null;
            wsRef.current.close();
        }

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
            console.log("✅ WebSocket 已连接");
            setIsConnected(true);
        };

        ws.onclose = () => {
            console.log("🔌 WebSocket 已断开");
            setIsConnected(false);
            wsRef.current = null;

            // 自动重连（指数退避）
            if (mountedRef.current) {
                const delay = Math.min(
                    RECONNECT_BASE_MS * Math.pow(2, 0),
                    RECONNECT_MAX_MS,
                );
                console.log(`🔄 ${delay}ms 后重连...`);
                reconnectTimerRef.current = setTimeout(connect, delay);
            }
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

                case "done": {
                    const toolCalls = toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined;
                    toolCallsRef.current = []; // 重置
                    setStatus(null); // 清除状态
                    setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === "assistant" && last.isStreaming) {
                            updated[updated.length - 1] = {
                                ...last,
                                // invoke 模式内容只在 done 消息里，需要写入
                                content: data.content || last.content,
                                isStreaming: false,
                                mode: data.mode,
                                elapsed: data.elapsed,
                                usage: data.usage,
                                toolCalls,
                                prompt: data.prompt,
                            };
                        }
                        return updated;
                    });
                    break;
                }

                case "error":
                    console.error("❌ 服务器错误:", data.content);
                    break;

                case "welcome":
                    console.log("👋 欢迎消息, 会话 ID:", data.sessionId);
                    if (!welcomeShownRef.current) {
                        welcomeShownRef.current = true;
                        setMessages((prev) => [
                            ...prev,
                            { role: "assistant", content: data.content },
                        ]);
                    }
                    break;

                case "status":
                    setStatus(data.content);
                    break;

                case "tool_call":
                    // 记录工具调用步骤
                    toolCallsRef.current.push({ name: data.name, args: data.args });
                    break;

                case "tool_result": {
                    // 更新最后一步工具调用的结果
                    const steps = [...toolCallsRef.current];
                    const lastStep = steps[steps.length - 1];
                    if (lastStep && !lastStep.result) {
                        lastStep.result = data.content;
                        toolCallsRef.current = steps;
                    }
                    break;
                }

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

        ws.onerror = () => {
            // React StrictMode 会卸载/重挂组件，首次连接被中断时也会触发 error，
            // 这里不打印 error 级别（太刺眼），交给 onclose 处理重连
        };
    }, []);

    // 挂载时建立连接，卸载时清理
    useEffect(() => {
        mountedRef.current = true;
        connect();
        return () => {
            mountedRef.current = false;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
            }
            if (wsRef.current) {
                wsRef.current.onopen = null;
                wsRef.current.onclose = null;
                wsRef.current.onmessage = null;
                wsRef.current.onerror = null;
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [connect]);

    const sendMessage = useCallback((content: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.error("WebSocket 未连接");
            return;
        }

        // 1. 清空上一步的工具调用记录
        toolCallsRef.current = [];

        // 2. 先把用户消息加到列表
        setMessages((prev) => [...prev, { role: "user", content }]);

        // 3. 创建一个空白 AI 消息占位
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

    return { isConnected, messages, sendMessage, clearMessages, sendSystemPrompt, currentMode, setCurrentMode, status };
}
