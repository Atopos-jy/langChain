import { llm } from "../llm";
import { addAIMessage, addUserMessage, type Session } from "../session";
import { logger } from "../logger";
import WebSocket from "ws";

/**
 * stream 模式：纯流式调用，无工具绑定
 * 文本逐字符推送 → 打字机效果
 */
export async function handleStream(
    ws: WebSocket,
    session: Session,
    content: string,
): Promise<void> {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    addUserMessage(session, content);

    try {
        const stream = await llm.stream(session.messages);
        let collected = "";

        for await (const chunk of stream) {
            const text = typeof chunk.content === "string" ? chunk.content : "";
            if (!text) continue;

            collected += text;

            // 逐字符发送 → 打字机效果
            for (const char of text) {
                ws.send(JSON.stringify({ type: "chunk", content: char }));
            }
        }

        const reply = collected || "（空回复）";
        addAIMessage(session, reply);
        ws.send(JSON.stringify({ type: "done", mode: "stream", content: reply }));
    } catch (error: any) {
        logger.error(`[${session.id}] stream 调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}
