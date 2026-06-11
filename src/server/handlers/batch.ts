import { llm } from "../llm";
import { addAIMessage, addUserMessage, type Session } from "../session";
import { logger } from "../logger";
import { getPromptTemplate } from "../prompts";
import { HumanMessage } from "@langchain/core/messages";
import WebSocket from "ws";

/**
 * batch 模式：批量处理
 * 一次发送多个问题，并行调用模型，一次性返回所有答案
 * 客户端用逗号或换行分隔多个问题
 */
export async function handleBatch(
    ws: WebSocket,
    session: Session,
    content: string,
    templateKey: string = "tech",
): Promise<void> {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    // 用逗号或换行分隔多个问题
    const questions = content.split(/[,，\n]/).map(q => q.trim()).filter(Boolean);

    if (questions.length === 0) {
        ws.send(JSON.stringify({ type: "error", content: "未检测到有效问题" }));
        return;
    }

    if (questions.length > 10) {
        ws.send(JSON.stringify({ type: "error", content: "一次最多处理10个问题" }));
        return;
    }

    logger.info(`[${session.id}] batch 模式: ${questions.length} 个问题`);

    try {
        addUserMessage(session, content);

        const start = Date.now();

        // 每个问题独立经模板包装，再批量调用
        const template = getPromptTemplate(templateKey);
        const prompts = await Promise.all(
            questions.map(async (q) => {
                const formatted = await template.format({ question: q });
                return [new HumanMessage(formatted)];
            })
        );
        const responses = await llm.batch(prompts);

        const results = responses.map((r, i) => ({
            question: questions[i],
            answer: typeof r.content === "string" ? r.content : "（非文本回复）",
        }));

        // 将完整回复存入对话历史
        const fullReply = results.map(r => `Q: ${r.question}\nA: ${r.answer}`).join("\n\n");
        addAIMessage(session, fullReply);

        // 发送前端期望的 batch_result 格式
        ws.send(JSON.stringify({
            type: "batch_result",
            mode: "batch",
            elapsed: Date.now() - start,
            results,
        }));
    } catch (error: any) {
        logger.error(`[${session.id}] batch 调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}
