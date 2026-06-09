import { llm } from "../llm";
import { addAIMessage, addUserMessage, type Session } from "../session";
import { logger } from "../logger";
import WebSocket from "ws";

/**
 * invoke 模式：非流式调用
 * 完整回复一次返回
 */
export async function handleInvoke(
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
        const response = await llm.invoke(session.messages);
        const text = typeof response.content === "string"
            ? response.content
            : "（非文本回复）";

        addAIMessage(session, text);

        // 先发 chunk 填充内容，再发 done 结束
        ws.send(JSON.stringify({ type: "chunk", content: text }));
        ws.send(JSON.stringify({ type: "done", mode: "invoke", content: text }));
    } catch (error: any) {
        logger.error(`[${session.id}] invoke 调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}
