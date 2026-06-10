/** 日志工具 */

function timestamp(): string {
    return new Date().toLocaleTimeString();
}

export const logger = {
    info: (msg: string) => console.log(`[${timestamp()}] ${msg}`),
    warn: (msg: string) => console.warn(`[${timestamp()}] ⚠️ ${msg}`),
    error: (msg: string, err?: unknown) =>
        console.error(`[${timestamp()}] ❌ ${msg}`, err ?? ""),
    debug: (msg: string) => {
        if (process.env.DEBUG)
            console.log(`[${timestamp()}] 🔍 ${msg}`);
    },
};
