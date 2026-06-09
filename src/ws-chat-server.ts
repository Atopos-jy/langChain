import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
    HumanMessage,
    AIMessage,
    ToolMessage,
    SystemMessage,
    type BaseMessage,
} from "@langchain/core/messages";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { z } from "zod";

dotenv.config();

// ========================================================================
// ① 工具定义（使用真实 API：wttr.in）
// ========================================================================

async function fetchWeather(location: string): Promise<string> {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return `天气 API 请求失败（HTTP ${res.status}）`;

    const data = await res.json();
    const current = data.current_condition?.[0];
    if (!current) return `${location} 的天气数据暂未收录`;

    const temp = current.temp_C;
    const feelsLike = current.FeelsLikeC;
    const humidity = current.humidity;
    const desc = current.lang_zh?.[0]?.value ?? current.weatherDesc?.[0]?.value;
    const windSpeed = current.windspeedKmph;

    return `${location}：${desc}，气温 ${temp}°C（体感 ${feelsLike}°C），湿度 ${humidity}%，风速 ${windSpeed}km/h`;
}

const getWeatherTool = tool(
    async (input: { location: string }) => {
        const result = await fetchWeather(input.location);
        logger.info(`[工具] 天气查询 "${input.location}" → ${result}`);
        return result;
    },
    {
        name: "get_weather",
        description:
            "查询指定城市的实时天气情况，当用户询问某个城市的天气时使用",
        schema: z.object({
            location: z.string().describe("城市名称，如北京、上海"),
        }),
    },
);

// ========================================================================
// ② 日志工具
// ========================================================================

const logger = {
    info: (msg: string) =>
        console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),
    warn: (msg: string) =>
        console.warn(`[${new Date().toLocaleTimeString()}] ⚠️ ${msg}`),
    error: (msg: string, err?: unknown) =>
        console.error(
            `[${new Date().toLocaleTimeString()}] ❌ ${msg}`,
            err ?? "",
        ),
    debug: (msg: string) => {
        if (process.env.DEBUG)
            console.log(`[${new Date().toLocaleTimeString()}] 🔍 ${msg}`);
    },
};

// ========================================================================
// ③ LLM 配置
// ========================================================================

const llm = new ChatOpenAI({
    model: "deepseek-v4-flash",
    apiKey: process.env.DEEPSEEK_API_KEY,
    temperature: 0.7,
    streamUsage: false,
    timeout: 30000,
    maxRetries: 2, // LangChain 内置重试
    configuration: {
        baseURL: "https://api.deepseek.com",
    },
});

const llmWithTools = llm.bindTools([getWeatherTool]);

// ========================================================================
// ④ 服务器配置
// ========================================================================

const PORT = parseInt(process.env.WS_PORT || "8080", 10);
const DEFAULT_SYSTEM_PROMPT =
    "你是一个智能助手，你有工具 get_weather 可以查询城市的天气情况。当用户询问天气时，请调用该工具获取准确信息，回答时请用友好、自然的方式表达。";

// ========================================================================
// ⑤ 限流配置
// ========================================================================

const RATE_LIMIT = {
    windowMs: 60_000, // 1 分钟窗口
    maxRequests: 20, // 每分钟最多 20 条
};

interface RateLimitState {
    count: number;
    windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitState>();

function checkRateLimit(sessionId: string): boolean {
    const now = Date.now();
    const state = rateLimitMap.get(sessionId);

    if (!state || now - state.windowStart > RATE_LIMIT.windowMs) {
        rateLimitMap.set(sessionId, { count: 1, windowStart: now });
        return true;
    }

    if (state.count >= RATE_LIMIT.maxRequests) {
        return false;
    }

    state.count++;
    return true;
}

// 定期清理过期的限流记录
setInterval(() => {
    const now = Date.now();
    for (const [id, state] of rateLimitMap) {
        if (now - state.windowStart > RATE_LIMIT.windowMs) {
            rateLimitMap.delete(id);
        }
    }
}, 60_000);

// ========================================================================
// ⑥ 错误重试工具函数
// ========================================================================

async function withRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries = 2,
): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            if (attempt > maxRetries) throw err;
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 4000); // 1s, 2s, 4s
            logger.warn(
                `${label} 失败（第 ${attempt} 次），${delay}ms 后重试: ${err.message}`,
            );
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw new Error("unreachable");
}

// ========================================================================
// ⑦ 会话管理
// ========================================================================

interface Session {
    id: string;
    messages: BaseMessage[];
    createdAt: number;
    messageCount: number;
}

const sessions = new Map<WebSocket, Session>();

// ========================================================================
// ⑧ WebSocket 服务器
// ========================================================================

const wss = new WebSocketServer({ port: PORT });

logger.info(`🤖 WebSocket 对话服务器已启动: ws://localhost:${PORT}`);
logger.info(`📝 支持工具: get_weather（实时天气 API）`);
logger.info(`📝 限流: 每分钟 ${RATE_LIMIT.maxRequests} 条/会话`);
logger.info(`📝 按 Ctrl+C 停止服务器`);

wss.on("connection", (ws) => {
    const sessionId = randomUUID().slice(0, 8);
    sessions.set(ws, {
        id: sessionId,
        messages: [new SystemMessage(DEFAULT_SYSTEM_PROMPT)],
        createdAt: Date.now(),
        messageCount: 0,
    });

    logger.info(`✅ [${sessionId}] 新客户端已连接`);

    ws.send(
        JSON.stringify({
            type: "welcome",
            content: "欢迎连接到 DeepSeek 对话机器人！支持实时天气查询。",
            sessionId,
        }),
    );

    // ---------- 消息处理 ----------

    ws.on("message", async (raw) => {
        const session = sessions.get(ws);
        if (!session) return;

        let data: { type?: string; content?: string; mode?: string };
        try {
            data = JSON.parse(raw.toString());
        } catch {
            ws.send(
                JSON.stringify({ type: "error", content: "无效的 JSON 格式" }),
            );
            return;
        }

        // 限流检查（只对 message 类型限流）
        if (data.type === "message" && !checkRateLimit(session.id)) {
            logger.warn(`[${session.id}] 限流触发，已忽略`);
            ws.send(
                JSON.stringify({
                    type: "error",
                    content: "请求过于频繁，请稍后再试",
                }),
            );
            return;
        }

        switch (data.type) {
            case "message": {
                session.messageCount++;
                logger.info(
                    `📤 [${session.id}] 第 ${session.messageCount} 条消息: ${data.content?.slice(0, 50)}`,
                );
                const start = Date.now();

                // 根据 mode 路由到不同的处理器
                const mode = data.mode || "stream";
                logger.info(`🎯 [${session.id}] 使用模式: ${mode}`);
                switch (mode) {
                    case "tool":
                        await handleToolMessage(ws, session, data.content || "");
                        break;
                    case "invoke":
                        await handleInvokeMessage(ws, session, data.content || "");
                        break;
                    case "stream":
                    default:
                        await handleStreamMessage(ws, session, data.content || "");
                        break;
                }

                const elapsed = Date.now() - start;
                logger.info(`💬 [${session.id}] 回复完成 (${elapsed}ms)`);
                break;
            }
            case "system":
                await handleSystemPrompt(ws, session, data.content || "");
                break;
            case "clear":
                handleClearHistory(ws, session);
                break;
            default:
                ws.send(
                    JSON.stringify({
                        type: "error",
                        content: `未知消息类型 "${data.type}"`,
                    }),
                );
        }
    });

    // ---------- 断开 / 错误 ----------

    ws.on("close", () => {
        const s = sessions.get(ws);
        logger.info(
            `🔌 [${sessionId}] 客户端已断开（共 ${s?.messageCount ?? 0} 条消息）`,
        );
        sessions.delete(ws);
        rateLimitMap.delete(sessionId);
    });

    ws.on("error", (err) => {
        logger.error(`[${sessionId}] WebSocket 错误`, err.message);
        sessions.delete(ws);
    });

    // ---------- 心跳 ----------

    const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
            logger.debug(`💓 [${sessionId}] 发送心跳 ping`);
        }
    }, 3_000);

    // 客户端 pong 响应由 ws 库自动处理
    ws.on("close", () => clearInterval(heartbeatInterval));

    // 5 秒内没收到 pong 就断开
    let pongTimeout: ReturnType<typeof setTimeout> | null = null;
    ws.on("pong", () => {
        logger.info(`💓 [${sessionId}] 收到心跳 pong`);
        if (pongTimeout) clearTimeout(pongTimeout);
        pongTimeout = setTimeout(() => {
            logger.warn(`[${sessionId}] 心跳超时，断开连接`);
            ws.terminate();
        }, 5_000);
    });
});

// ========================================================================
// ⑨ 核心：工具调用循环（带重试）
// ========================================================================

async function handleToolMessage(
    ws: WebSocket,
    session: Session,
    content: string,
) {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    session.messages.push(new HumanMessage(content));

    let rounds = 0;
    const MAX_ROUNDS = 5;

    while (rounds < MAX_ROUNDS) {
        try {
            // ① 流式调用模型（打字机效果）
            // 模型已配置 maxRetries:2，stream 由 LangChain 内部重试
            const stream = await llmWithTools.stream(session.messages);
            rounds++;

            let collectedContent = "";
            let detectedToolCall = false;
            // 流式工具调用分片合并（支持多工具并行，按 index 区分）
            const mergedToolCallChunks: Record<
                number,
                { name: string; args: string; id: string }
            > = {};

            for await (const chunk of stream) {
                // 检测工具调用分片
                const callChunks = chunk.tool_call_chunks;
                if (callChunks && callChunks.length > 0) {
                    detectedToolCall = true;
                    for (const tcc of callChunks) {
                        const idx = tcc.index ?? 0;
                        if (!mergedToolCallChunks[idx]) {
                            mergedToolCallChunks[idx] = {
                                name: "",
                                args: "",
                                id: "",
                            };
                        }
                        if (tcc.name) mergedToolCallChunks[idx].name += tcc.name;
                        if (tcc.args) mergedToolCallChunks[idx].args += tcc.args;
                        if (tcc.id) mergedToolCallChunks[idx].id += tcc.id;
                    }
                }

                // 文本内容立即推送 → 客户端实现打字机效果
                const text =
                    typeof chunk.content === "string" ? chunk.content : "";
                if (text) {
                    collectedContent += text;
                    // 逐字符拆开发送 → 打字机效果
                    for (const char of text) {
                        ws.send(JSON.stringify({ type: "chunk", content: char }));
                    }
                }
            }

            // ② 判断是否是工具调用
            if (detectedToolCall) {
                logger.info(
                    `🔧 [${session.id}] 模型调用了工具（流式）`,
                );

                for (const [, tc] of Object.entries(mergedToolCallChunks)) {
                    let args: Record<string, unknown>;
                    try {
                        args = JSON.parse(tc.args);
                    } catch {
                        args = {};
                    }

                    ws.send(
                        JSON.stringify({
                            type: "tool_call",
                            name: tc.name,
                            args,
                        }),
                    );

                    // 执行工具（带重试）
                    const result = await withRetry(
                        () => getWeatherTool.invoke(args as any),
                        `[${session.id}] 工具 ${tc.name}`,
                        1,
                    );

                    ws.send(
                        JSON.stringify({
                            type: "tool_result",
                            content: String(result),
                        }),
                    );

                    // 重建消息历史
                    session.messages.push(
                        new AIMessage({
                            content: collectedContent,
                            tool_calls: [
                                { name: tc.name, args, id: tc.id },
                            ] as any,
                        }),
                    );
                    session.messages.push(
                        new ToolMessage({
                            content: String(result),
                            tool_call_id: tc.id,
                        }),
                    );
                }
                // 继续循环 → 让模型基于工具结果生成最终回复
            } else {
                // ③ 纯文本回复 → 结束
                const text = collectedContent || "（空回复）";
                session.messages.push(new AIMessage(text));

                ws.send(
                    JSON.stringify({
                        type: "done",
                        mode: "tool",
                        content: text,
                    }),
                );
                return;
            }
        } catch (error: any) {
            logger.error(
                `[${session.id}] 调用失败（重试耗尽）`,
                error.message,
            );
            ws.send(
                JSON.stringify({
                    type: "error",
                    content: `请求失败: ${error.message}`,
                }),
            );
            return;
        }
    }

    logger.warn(
        `[${session.id}] 工具调用超过 ${MAX_ROUNDS} 轮，强制终止`,
    );
    ws.send(
        JSON.stringify({
            type: "error",
            content: "工具调用次数过多，已自动终止",
        }),
    );
}

// ========================================================================
// ⑨-2 非流式调用（invoke 模式）
// ========================================================================

async function handleInvokeMessage(
    ws: WebSocket,
    session: Session,
    content: string,
) {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    session.messages.push(new HumanMessage(content));

    try {
        const response = await llm.invoke(session.messages);
        const text = typeof response.content === "string" ? response.content : "（非文本回复）";
        session.messages.push(new AIMessage(text));
        // 先发 chunk 让客户端填充内容（invoke 模式没有流式 chunk）
        ws.send(JSON.stringify({ type: "chunk", content: text }));
        ws.send(JSON.stringify({ type: "done", mode: "invoke", content: text }));
    } catch (error: any) {
        logger.error(`[${session.id}] 调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}

// ========================================================================
// ⑨-1 流式调用（stream 模式，无工具绑定——真正的打字机效果）
// ========================================================================

async function handleStreamMessage(
    ws: WebSocket,
    session: Session,
    content: string,
) {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    session.messages.push(new HumanMessage(content));

    try {
        // 使用不绑定工具的 llm.stream() → 真正的逐 token 流式
        const stream = await llm.stream(session.messages);
        let collectedContent = "";

        for await (const chunk of stream) {
            const text = typeof chunk.content === "string" ? chunk.content : "";
            if (text) {
                collectedContent += text;
                logger.debug(`[${session.id}] API chunk 长度=${text.length}: "${text.slice(0, 20)}..."`);
                // 逐字符拆开发送 → 客户端看到打字机效果
                // 不受 API chunk 大小影响
                for (const char of text) {
                    ws.send(JSON.stringify({ type: "chunk", content: char }));
                }
            }
        }

        const text = collectedContent || "（空回复）";
        session.messages.push(new AIMessage(text));
        ws.send(JSON.stringify({ type: "done", mode: "stream", content: text }));
    } catch (error: any) {
        logger.error(`[${session.id}] 流式调用失败`, error.message);
        ws.send(JSON.stringify({ type: "error", content: `请求失败: ${error.message}` }));
    }
}

// ========================================================================
// ⑩ 系统提示词 & 清除历史
// ========================================================================

async function handleSystemPrompt(
    ws: WebSocket,
    session: Session,
    content: string,
) {
    if (!content.trim()) return;
    const idx = session.messages.findIndex((m) => m._getType() === "system");
    if (idx !== -1) {
        session.messages[idx] = new SystemMessage(content);
    } else {
        session.messages.unshift(new SystemMessage(content));
    }
    ws.send(
        JSON.stringify({ type: "system_set", content: "系统提示词已更新" }),
    );
    logger.info(`📋 [${session.id}] 系统提示词已更新`);
}

function handleClearHistory(ws: WebSocket, session: Session) {
    const sys = session.messages.find((m) => m._getType() === "system");
    session.messages = sys ? [sys] : [new SystemMessage(DEFAULT_SYSTEM_PROMPT)];
    ws.send(
        JSON.stringify({ type: "history_cleared", content: "对话历史已清除" }),
    );
    logger.info(`🗑️ [${session.id}] 对话历史已清除`);
}

// ========================================================================
// ⑪ 优雅关闭
// ========================================================================

process.on("SIGINT", () => {
    logger.info("🛑 收到 SIGINT，正在关闭服务器...");
    wss.close(() => {
        logger.info("✅ 服务器已关闭");
        process.exit(0);
    });
});

process.on("SIGTERM", () => {
    wss.close(() => process.exit(0));
});
