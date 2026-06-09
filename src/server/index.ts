import { createServer } from "./ws-server";
import { logger } from "./logger";

// dotenv 已在 config.ts 中加载

const wss = createServer();

// ========================================================================
// 优雅关闭
// ========================================================================

function shutdown(signal: string) {
    logger.info(`🛑 收到 ${signal}，正在关闭服务器...`);
    wss.close(() => {
        logger.info("✅ 服务器已关闭");
        process.exit(0);
    });
    // 强制退出
    setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
