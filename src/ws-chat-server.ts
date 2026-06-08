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

        let data: { type?: string; content?: string };
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
                await handleUserMessage(ws, session, data.content);
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

async function handleUserMessage(ws: WebSocket, session: Session, content?: string) {
    if (!content || typeof content !== "string" || !content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息内容不能为空" }));
        return;
    }

    // 添加用户消息到历史
    session.messages.push(new HumanMessage(content));

    try {
        const stream = await llm.stream(session.messages);
        let fullResponse = "";

        // 流式输出每个 token
        for await (const chunk of stream) {
            const rawContent = chunk.content;
            if (rawContent == null) continue;

            const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
            if (!text) continue;

            fullResponse += text;
            ws.send(JSON.stringify({ type: "chunk", content: text }));
        }

        // 添加 AI 回复到历史（保留上下文）
        session.messages.push(new AIMessage(fullResponse));

        ws.send(JSON.stringify({ type: "done", content: fullResponse }));
        console.log(`[${session.id}] 💬 回复完成 (${fullResponse.length} 字符)`);
    } catch (error: any) {
        console.error(`[${session.id}] ❌ 调用失败:`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
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
