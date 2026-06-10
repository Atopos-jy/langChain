import { llm } from "../llm";
import { addAIMessage, addUserMessage, type Session } from "../session";
import { logger } from "../logger";
import { getPromptTemplate, jsonPromptTemplate } from "../prompts";
import { JsonOutputParser } from "@langchain/core/output_parsers";
import WebSocket from "ws";

/**
 * structured 模式：结构化输出
 * 将模型回复解析为 JSON 对象
 * 客户端描述需求，服务器返回结构化数据
 *
 * 知识点：结合了 PromptTemplate + .pipe() + JsonOutputParser
 * 详见 src/4-lcel-complete.ts
 */

const parser = new JsonOutputParser();
const chain = jsonPromptTemplate.pipe(llm).pipe(parser);

export async function handleStructured(
    ws: WebSocket,
    session: Session,
    content: string,
    templateKey: string = "tech",
): Promise<void> {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    try {
        // 标准模板包装后存入历史（与其他模式保持一致）
        const template = getPromptTemplate(templateKey);
        const formatted = await template.format({ question: content });
        addUserMessage(session, formatted);

        const start = Date.now();

        // 调用三节点链，直接拿到 JavaScript 对象
        const result = await chain.invoke({ question: content });

        // 存到对话历史（转为字符串存储）
        addAIMessage(session, JSON.stringify(result));

        // 发送前端期望的 structured_result 格式
        ws.send(JSON.stringify({
            type: "structured_result",
            mode: "structured",
            elapsed: Date.now() - start,
            result,
        }));
    } catch (error: any) {
        logger.error(`[${session.id}] structured 调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}
