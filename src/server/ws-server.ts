import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { SystemMessage } from "@langchain/core/messages";
import { CONFIG } from "./config";
import { logger } from "./logger";
import { createSession, getSession, deleteSession, clearHistory, type Session } from "./session";
import { checkRateLimit, clearRateLimit } from "./rate-limiter";
import { handleStream } from "./handlers/stream";
import { handleInvoke } from "./handlers/invoke";

/** 客户端消息格式 */
interface ClientMessage {
    type?: string;
    content?: string;
    mode?: string;
}

/**
 * 创建并启动 WebSocket 服务器
 * 返回 wss 实例，供 index.ts 做优雅关闭
 */
export function createServer(): WebSocketServer {
    const wss = new WebSocketServer({ port: CONFIG.port });

    logger.info(`🤖 WebSocket 服务器已启动: ws://localhost:${CONFIG.port}`);
    logger.info(`📝 模式: stream / invoke`);
    logger.info(`📝 限流: 每分钟 ${CONFIG.rateLimit.maxRequests} 条/会话`);
    logger.info(`📝 按 Ctrl+C 停止`);

    wss.on("connection", (ws) => {
        const sessionId = randomUUID().slice(0, 8);
        const session = createSession(sessionId);

        // 绑定 session 到 ws，方便其他地方获取
        (ws as any)._sessionId = sessionId;

        logger.info(`✅ [${sessionId}] 新客户端已连接`);

        ws.send(JSON.stringify({
            type: "welcome",
            content: "欢迎连接到 DeepSeek 对话机器人！",
            sessionId,
        }));

        // ---------- 消息处理 ----------

        ws.on("message", async (raw) => {
            let data: ClientMessage;
            try {
                data = JSON.parse(raw.toString());
            } catch {
                ws.send(JSON.stringify({ type: "error", content: "无效的 JSON 格式" }));
                return;
            }

            // 从 session map 中获取最新状态
            const sess = getSession(sessionId);
            if (!sess) return;

            // 限流
            if (data.type === "message" && !checkRateLimit(sessionId)) {
                logger.warn(`[${sessionId}] 限流触发`);
                ws.send(JSON.stringify({ type: "error", content: "请求过于频繁，请稍后再试" }));
                return;
            }

            switch (data.type) {
                case "message": {
                    logger.info(`📤 [${sessionId}] 消息: ${data.content?.slice(0, 50)}`);
                    const mode = data.mode || "stream";
                    logger.info(`🎯 [${sessionId}] 模式: ${mode}`);

                    const start = Date.now();

                    if (mode === "invoke") {
                        await handleInvoke(ws, sess, data.content || "");
                    } else {
                        await handleStream(ws, sess, data.content || "");
                    }

                    logger.info(`💬 [${sessionId}] 完成 (${Date.now() - start}ms)`);
                    break;
                }

                case "system": {
                    updateSystemPrompt(sess, data.content || "");
                    ws.send(JSON.stringify({ type: "system_set", content: "系统提示词已更新" }));
                    logger.info(`📋 [${sessionId}] 系统提示词已更新`);
                    break;
                }

                case "clear":
                    clearHistory(sess);
                    ws.send(JSON.stringify({ type: "history_cleared", content: "对话历史已清除" }));
                    logger.info(`🗑️ [${sessionId}] 对话历史已清除`);
                    break;

                default:
                    ws.send(JSON.stringify({ type: "error", content: `未知消息类型 "${data.type}"` }));
            }
        });

        // ---------- 断开 / 错误 ----------

        ws.on("close", () => {
            const s = getSession(sessionId);
            logger.info(`🔌 [${sessionId}] 断开（共 ${s?.messageCount ?? 0} 条消息）`);
            deleteSession(sessionId);
            clearRateLimit(sessionId);
        });

        ws.on("error", (err) => {
            logger.error(`[${sessionId}] WebSocket 错误`, err.message);
            deleteSession(sessionId);
            clearRateLimit(sessionId);
        });

        // ---------- 心跳 ----------

        const heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, CONFIG.heartbeatInterval);

        let pongTimer: ReturnType<typeof setTimeout> | null = null;
        ws.on("pong", () => {
            if (pongTimer) clearTimeout(pongTimer);
            pongTimer = setTimeout(() => {
                logger.warn(`[${sessionId}] 心跳超时，断开`);
                ws.terminate();
            }, CONFIG.heartbeatTimeout);
        });

        ws.on("close", () => {
            clearInterval(heartbeatTimer);
            if (pongTimer) clearTimeout(pongTimer);
        });
    });

    return wss;
}

/** 更新系统提示词 */
function updateSystemPrompt(session: Session, content: string) {
    if (!content.trim()) return;
    const idx = session.messages.findIndex((m) => m._getType() === "system");
    if (idx !== -1) {
        session.messages[idx] = new SystemMessage(content);
    } else {
        session.messages.unshift(new SystemMessage(content));
    }
}
