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
            case "message":
                session.messageCount++;
                logger.info(
                    `📤 [${session.id}] 第 ${session.messageCount} 条消息: ${data.content?.slice(0, 50)}`,
                );
                const start = Date.now();
                await handleToolMessage(ws, session, data.content || "");
                const elapsed = Date.now() - start;
                logger.info(`💬 [${session.id}] 回复完成 (${elapsed}ms)`);
                break;
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
            // 带重试的模型调用
            const response = await withRetry(
                () => llmWithTools.invoke(session.messages),
                `[${session.id}] llm.invoke`,
                2,
            );
            rounds++;

            if (response.tool_calls && response.tool_calls.length > 0) {
                const tc = response.tool_calls[0];
                logger.info(
                    `🔧 [${session.id}] 模型调用工具: ${tc.name}(${JSON.stringify(tc.args)})`,
                );

                ws.send(
                    JSON.stringify({
                        type: "tool_call",
                        name: tc.name,
                        args: tc.args,
                    }),
                );

                // 执行工具（也带重试）
                const result = await withRetry(
                    () => getWeatherTool.invoke(tc.args as any),
                    `[${session.id}] 工具 ${tc.name}`,
                    1,
                );

                ws.send(
                    JSON.stringify({
                        type: "tool_result",
                        content: String(result),
                    }),
                );

                session.messages.push(response);
                session.messages.push(
                    new ToolMessage({
                        content: String(result),
                        tool_call_id: tc.id || "",
                    }),
                );
            } else {
                const text =
                    typeof response.content === "string"
                        ? response.content
                        : JSON.stringify(response.content);
                session.messages.push(response);

                ws.send(JSON.stringify({ type: "chunk", content: text }));
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
            logger.error(`[${session.id}] 调用失败（重试耗尽）`, error.message);
            ws.send(
                JSON.stringify({
                    type: "error",
                    content: `请求失败: ${error.message}`,
                }),
            );
            return;
        }
    }

    logger.warn(`[${session.id}] 工具调用超过 ${MAX_ROUNDS} 轮，强制终止`);
    ws.send(
        JSON.stringify({
            type: "error",
            content: "工具调用次数过多，已自动终止",
        }),
    );
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
