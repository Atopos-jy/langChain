import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import {
    HumanMessage,
    AIMessage,
    SystemMessage,
    type BaseMessage,
} from "@langchain/core/messages";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { z } from "zod";

dotenv.config();

// ==================== LLM 配置 ====================

const llm = new ChatOpenAI({
    model: "deepseek-v4-flash",
    apiKey: process.env.DEEPSEEK_API_KEY,
    temperature: 0.7,
    streamUsage: false,
    configuration: {
        baseURL: "https://api.deepseek.com",
    },
});

// ==================== 服务器配置 ====================

const PORT = parseInt(process.env.WS_PORT || "8080", 10);
const DEFAULT_SYSTEM_PROMPT = "你是一个智能助手，你会根据用户的问题回答用户的问题，直接回答不知道。";

// ==================== 会话管理 ====================

interface Session {
    id: string;
    messages: BaseMessage[];
}

const sessions = new Map<WebSocket, Session>();

// ==================== WebSocket 服务器 ====================

const wss = new WebSocketServer({ port: PORT });

console.log(`🤖 WebSocket 对话服务器已启动: ws://localhost:${PORT}`);
console.log(`📝 按 Ctrl+C 停止服务器`);

wss.on("connection", (ws) => {
    const sessionId = randomUUID().slice(0, 8);
    sessions.set(ws, {
        id: sessionId,
        messages: [new SystemMessage(DEFAULT_SYSTEM_PROMPT)],
    });

    console.log(`[${sessionId}] ✅ 新客户端已连接`);

    // 发送欢迎消息
    ws.send(
        JSON.stringify({
            type: "welcome",
            content: "欢迎连接到 DeepSeek 对话机器人！发送消息开始聊天。",
            sessionId,
        }),
    );

    // ==================== 处理消息 ====================

    ws.on("message", async (raw) => {
        const session = sessions.get(ws);
        if (!session) return;

        let data: { type?: string; content?: string; mode?: string };
        try {
            data = JSON.parse(raw.toString());
        } catch {
            ws.send(JSON.stringify({ type: "error", content: "无效的 JSON 格式，请发送 JSON 对象" }));
            return;
        }

        if (!data.type || typeof data.type !== "string") {
            ws.send(JSON.stringify({ type: "error", content: "消息必须包含 type 字段" }));
            return;
        }

        switch (data.type) {
            case "message":
                await handleUserMessage(ws, session, data.content, data.mode || "stream");
                break;

            case "system":
                await handleSystemPrompt(ws, session, data.content);
                break;

            case "clear":
                handleClearHistory(ws, session);
                break;

            default:
                ws.send(
                    JSON.stringify({
                        type: "error",
                        content: `未知消息类型 "${data.type}"。支持的类型: message, system, clear`,
                    }),
                );
        }
    });

    // ==================== 连接关闭 / 错误 ====================

    ws.on("close", () => {
        console.log(`[${sessionId}] 🔌 客户端已断开`);
        sessions.delete(ws);
    });

    ws.on("error", (err) => {
        console.error(`[${sessionId}] ❌ WebSocket 错误:`, err.message);
        sessions.delete(ws);
    });
});

// ==================== 消息处理函数 ====================

async function handleUserMessage(ws: WebSocket, session: Session, content?: string, mode: string = "stream") {
    if (!content || typeof content !== "string" || !content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息内容不能为空" }));
        return;
    }

    console.log(`[${session.id}] 🎯 调用模式: ${mode}`);
    console.log(`[${session.id}] 📤 用户输入: ${content}`);

    switch (mode) {
        case "invoke":
            await handleInvoke(ws, session, content);
            break;
        case "stream":
            await handleStream(ws, session, content);
            break;
        case "batch":
            await handleBatch(ws, session, content);
            break;
        case "structured":
            await handleStructured(ws, session, content);
            break;
        default:
            ws.send(JSON.stringify({ type: "error", content: `未知模式: ${mode}` }));
    }
}

// ==================== 模式1: stream（流式输出） ====================
async function handleStream(ws: WebSocket, session: Session, content: string) {
    session.messages.push(new HumanMessage(content));
    console.log(`[${session.id}] 🔄 llm.stream() — 开始流式输出...`);

    try {
        const stream = await llm.stream(session.messages);
        let fullResponse = "";

        for await (const chunk of stream) {
            const rawContent = chunk.content;
            if (rawContent == null) continue;

            const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
            if (!text) continue;

            fullResponse += text;
            ws.send(JSON.stringify({ type: "chunk", content: text }));
        }

        session.messages.push(new AIMessage(fullResponse));
        console.log(`[${session.id}] ✅ stream 完成 (${fullResponse.length} 字符)`);
        ws.send(JSON.stringify({ type: "done", content: fullResponse, mode: "stream" }));
    } catch (error: any) {
        console.error(`[${session.id}] ❌ stream 失败:`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `stream 失败: ${error.message}` }));
    }
}

// ==================== 模式2: invoke（一次性返回） ====================
async function handleInvoke(ws: WebSocket, session: Session, content: string) {
    session.messages.push(new HumanMessage(content));
    console.log(`[${session.id}] 📡 llm.invoke() — 等待完整回复...`);

    try {
        const start = Date.now();
        const result = await llm.invoke(session.messages);
        const elapsed = Date.now() - start;

        const text = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
        session.messages.push(new AIMessage(text));

        console.log(`[${session.id}] ✅ invoke 完成 (${text.length} 字符, ${elapsed}ms)`);
        console.log(`[${session.id}] 📊 Token用量:`, JSON.stringify(result.usage_metadata));

        // invoke 一次性返回完整内容
        ws.send(JSON.stringify({ type: "chunk", content: text }));
        ws.send(JSON.stringify({
            type: "done",
            content: text,
            mode: "invoke",
            elapsed,
            usage: result.usage_metadata,
        }));
    } catch (error: any) {
        console.error(`[${session.id}] ❌ invoke 失败:`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `invoke 失败: ${error.message}` }));
    }
}

// ==================== 模式3: batch（批量并发） ====================
async function handleBatch(ws: WebSocket, session: Session, content: string) {
    // 用户输入用逗号/分号/换行分隔多个问题
    const questions = content.split(/[,;，；\n]/).map(q => q.trim()).filter(Boolean);

    if (questions.length < 2) {
        ws.send(JSON.stringify({ type: "error", content: "batch 模式请至少输入 2 个问题，用逗号或分号分隔" }));
        return;
    }

    console.log(`[${session.id}] ⚡ llm.batch() — ${questions.length} 个问题并发调用...`);
    questions.forEach((q, i) => console.log(`[${session.id}]  问题 ${i + 1}: ${q}`));

    try {
        const systemMsg = session.messages.find(m => m._getType() === "system");
        const start = Date.now();

        // 每个问题单独构造成完整的对话（带系统提示）
        const batches = questions.map(q => {
            const msgs: BaseMessage[] = systemMsg ? [systemMsg] : [];
            msgs.push(new HumanMessage(q));
            return msgs;
        });

        const responses = await llm.batch(batches, { maxConcurrency: 5 });
        const elapsed = Date.now() - start;

        console.log(`[${session.id}] ✅ batch 完成 (${elapsed}ms)`);

        // 逐个返回每个问题的答案
        ws.send(JSON.stringify({
            type: "batch_result",
            mode: "batch",
            elapsed,
            results: responses.map((r, i) => ({
                question: questions[i],
                answer: typeof r.content === "string" ? r.content : JSON.stringify(r.content),
            })),
        }));
        ws.send(JSON.stringify({ type: "done", mode: "batch" }));
    } catch (error: any) {
        console.error(`[${session.id}] ❌ batch 失败:`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `batch 失败: ${error.message}` }));
    }
}

// ==================== 模式4: structured（结构化输出） ====================
const MovieSchema = z.object({
    title: z.string().describe("标题"),
    year: z.number().describe("年份"),
    director: z.string().describe("导演"),
    rating: z.number().describe("评分"),
});

async function handleStructured(ws: WebSocket, session: Session, content: string) {
    console.log(`[${session.id}] 📋 llm.withStructuredOutput() — 结构化输出...`);

    try {
        const start = Date.now();
        const modelWithStructure = llm.withStructuredOutput(MovieSchema);
        const result = await modelWithStructure.invoke(content);
        const elapsed = Date.now() - start;

        console.log(`[${session.id}] ✅ structured 完成 (${elapsed}ms)`);
        console.log(`[${session.id}] 📊 结构化结果:`, JSON.stringify(result));

        ws.send(JSON.stringify({
            type: "structured_result",
            mode: "structured",
            elapsed,
            result,
        }));
        ws.send(JSON.stringify({ type: "done", mode: "structured" }));
    } catch (error: any) {
        console.error(`[${session.id}] ❌ structured 失败:`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `structured 失败: ${error.message}` }));
    }
}

async function handleSystemPrompt(ws: WebSocket, session: Session, content?: string) {
    if (!content || typeof content !== "string" || !content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "系统提示词不能为空" }));
        return;
    }

    // 替换已有的 SystemMessage，或在开头插入
    const sysMsgIndex = session.messages.findIndex((m) => m._getType() === "system");
    if (sysMsgIndex !== -1) {
        session.messages[sysMsgIndex] = new SystemMessage(content);
    } else {
        session.messages.unshift(new SystemMessage(content));
    }

    ws.send(JSON.stringify({ type: "system_set", content: "系统提示词已更新" }));
    console.log(`[${session.id}] 📋 系统提示词已更新`);
}

function handleClearHistory(ws: WebSocket, session: Session) {
    // 保留系统提示词，清除对话消息
    const systemMsg = session.messages.find((m) => m._getType() === "system");
    session.messages = systemMsg
        ? [systemMsg]
        : [new SystemMessage(DEFAULT_SYSTEM_PROMPT)];

    ws.send(JSON.stringify({ type: "history_cleared", content: "对话历史已清除" }));
    console.log(`[${session.id}] 🗑️ 对话历史已清除`);
}

// ==================== 优雅关闭 ====================

process.on("SIGINT", () => {
    console.log("\n🛑 正在关闭服务器...");
    wss.close(() => {
        console.log("✅ 服务器已关闭");
        process.exit(0);
    });
});

process.on("SIGTERM", () => {
    wss.close(() => process.exit(0));
});
