import { llm } from "../llm";
import { addAIMessage, addUserMessage, type Session } from "../session";
import { logger } from "../logger";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import WebSocket from "ws";

const parser = new StringOutputParser();

// ============================================================
// 深度思考模式 —— 把 RunnableSequence 用在真实后端
//
// 传统模式：question → Prompt → LLM → reply
// 深度模式：question → 拆解子问题 → 逐一研究 → 综合回答
//
// 核心优势：
//   - 每步只做一件事，模型不会"注意力分散"
//   - 前一步的成果可以透传给后续步骤
// ============================================================

// Step 1：分析问题，拆解为子问题
const analyzePrompt = PromptTemplate.fromTemplate(`
你是一个思维分析师。请将以下问题拆解为 2-3 个关键的子问题。
子问题要覆盖问题的不同层面，每个子问题用 "- " 开头。

用户问题：{question}

子问题：
`);

// Step 2：针对子问题逐一深入研究
const researchPrompt = PromptTemplate.fromTemplate(`
请逐一回答以下子问题，每个回答不超过 150 字，专业且易懂。

{subQuestions}

请开始回答：
`);

// Step 3：综合成最终回答
const synthesizePrompt = PromptTemplate.fromTemplate(`
请将以下分析内容综合成一个结构清晰、通俗易懂的最终回答。
要求：
- 分点回答，用生活例子说明
- 语气自然，像一个专家在聊天
- 不要提"子问题"或"分析过程"

分析内容：
{research}

最终回答：
`);

/** 安全发送 WebSocket 消息，失败时只记日志不抛异常 */
function sendStatus(ws: WebSocket, content: string) {
    try {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "status", content }));
        } else {
            logger.warn(`⚠️ WebSocket 状态异常 (${ws.readyState})，无法发送: ${content}`);
        }
    } catch (err: any) {
        logger.error(`❌ 发送状态消息失败: ${err.message}`);
    }
}

/**
 * 创建深度思考链（工厂函数）
 * 把 ws 注入到链中，每步执行时推送进度消息
 */
function createDeepChain(ws: WebSocket) {
    return RunnableSequence.from([
        // ===== Step 1：分析，拆解子问题 =====
        async (input: { question: string }) => {
            sendStatus(ws, "🔍 正在分析问题...");

            const subQuestions = await analyzePrompt.pipe(llm).pipe(parser).invoke({
                question: input.question,
            });
            logger.info(`🧩 子问题拆解:\n${subQuestions}`);
            return { question: input.question, subQuestions };
        },

        // ===== Step 2：逐一研究子问题 =====
        //     透传 question 和 subQuestions 给下一步
        async (data: { question: string; subQuestions: string }) => {
            sendStatus(ws, "📚 正在逐一研究子问题...");

            const research = await researchPrompt.pipe(llm).pipe(parser).invoke({
                subQuestions: data.subQuestions,
            });
            logger.info(`📚 研究结果:\n${research}`);
            return { question: data.question, subQuestions: data.subQuestions, research };
        },

        // ===== Step 3：综合成最终回答 =====
        //     此时还能访问 question / subQuestions / research 三份数据
        async (data: { question: string; subQuestions: string; research: string }) => {
            sendStatus(ws, "✍️ 正在综合生成最终回答...");

            const final = await synthesizePrompt.pipe(llm).pipe(parser).invoke({
                research: data.research,
            });
            return final;
        },
    ]);
}

/**
 * deep 模式：深度思考
 * 任务拆解 → 子问题研究 → 综合回答，三步流水线
 */
export async function handleDeep(
    ws: WebSocket,
    session: Session,
    content: string,
    templateKey?: string,
): Promise<void> {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    // 保存原始用户消息到历史
    addUserMessage(session, content);

    try {
        const start = Date.now();

        // 创建带进度推送的链，开始执行
        const chain = createDeepChain(ws);
        const result = await chain.invoke({ question: content });

        const elapsed = Date.now() - start;

        addAIMessage(session, result);

        ws.send(JSON.stringify({
            type: "done",
            mode: "deep",
            content: result,
            elapsed,
        }));

        logger.info(`[${session.id}] 🧠 deep 完成 (${elapsed}ms)`);
    } catch (error: any) {
        logger.error(`[${session.id}] deep 调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}
