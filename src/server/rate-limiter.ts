import { CONFIG } from "./config";

/** 限流状态 */
interface RateLimitState {
    count: number;
    windowStart: number;
}

const map = new Map<string, RateLimitState>();

/** 检查是否允许通过，false 表示限流触发 */
export function checkRateLimit(sessionId: string): boolean {
    const now = Date.now();
    const state = map.get(sessionId);
    const { windowMs, maxRequests } = CONFIG.rateLimit;

    if (!state || now - state.windowStart > windowMs) {
        map.set(sessionId, { count: 1, windowStart: now });
        return true;
    }

    if (state.count >= maxRequests) return false;

    state.count++;
    return true;
}

/** 清理会话的限流记录 */
export function clearRateLimit(sessionId: string): void {
    map.delete(sessionId);
}

/** 定期清理过期记录（每 60s） */
setInterval(() => {
    const now = Date.now();
    for (const [id, state] of map) {
        if (now - state.windowStart > CONFIG.rateLimit.windowMs) {
            map.delete(id);
        }
    }
}, 60_000);
