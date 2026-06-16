import dotenv from "dotenv";
dotenv.config();

/** 服务器配置 */

export const CONFIG = {
    /** WebSocket 端口 */
    port: parseInt(process.env.WS_PORT || "8080", 10),

    /** LLM 模型配置 */
    llm: {
        model: "GLM-4.7",
        apiKey: process.env.ARK_API_KEY,
        temperature: 0.7,
        timeout: 30000,
        maxRetries: 2,
        baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
    },

    /** 限流：每分钟每会话最多请求数 */
    rateLimit: {
        windowMs: 60_000,
        maxRequests: 20,
    },

    /** 默认系统提示词 */
    systemPrompt: "你是一个智能助手，请用友好、自然的方式回答用户的问题。",

    /** 心跳间隔（毫秒） */
    heartbeatInterval: 3_000,

    /** 心跳超时（毫秒，超过此时间未收到 pong 则断开） */
    heartbeatTimeout: 10_000,
};
