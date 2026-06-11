import { useEffect, useRef } from "react";
import type { ChatMessage as ChatMessageType } from "../types/message";
import { ChatMessage } from "./ChatMessage";

interface Props {
    messages: ChatMessageType[];
}

export function MessageList({ messages }: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    // 每次 messages 变化时自动滚到底部
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    if (messages.length === 0) {
        return (
            <div style={{ textAlign: "center", color: "#999", marginTop: 80 }}>
                发送一条消息开始聊天
            </div>
        );
    }

    return (
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
            {messages.map((msg, i) => (
                <ChatMessage key={i} message={msg} />
            ))}
            <div ref={bottomRef} />
        </div>
    );
}
