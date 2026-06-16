import { llm } from "../llm";
import { addAIMessage, addUserMessage, type Session } from "../session";
import { getContextMessages, addToVectorStore, strategyLabel } from "../memory-strategies";
import { logger } from "../logger";
import { getPromptTemplate } from "../prompts";
import WebSocket from "ws";

/**
 * stream 模式：纯流式调用，无工具绑定
 * 文本逐字符推送 → 打字机效果
 */
export async function handleStream(
    ws: WebSocket,
    session: Session,
    content: string,
    templateKey: string = "tech",
): Promise<void> {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    // 根据客户端选择的模板包装
    const template = getPromptTemplate(templateKey);
    const formatted = await template.format({ question: content });
    logger.info(`[${session.id}] 🔍 模板[${templateKey}] 实际发给 AI 的文本:\n${formatted}`);
    addUserMessage(session, formatted);

    try {
        // 根据记忆策略构建上下文
        const contextMessages = await getContextMessages(session, content);
        logger.info(`[${session.id}] 🧠 记忆策略: ${strategyLabel(session.memoryStrategy)} (${contextMessages.length} 条消息)`);

        const stream = await llm.stream(contextMessages);
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

        // 向量策略：将对话存入向量库
        if (session.memoryStrategy === "vector") {
            addToVectorStore(session, content, reply);
        }

        ws.send(JSON.stringify({ type: "done", mode: "stream", content: reply, prompt: formatted }));
    } catch (error: any) {
        logger.error(`[${session.id}] stream 调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}
