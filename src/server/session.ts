import { SystemMessage, HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { CONFIG } from "./config";

// ============================================================
// 记忆策略类型
// ============================================================

export type MemoryStrategy = "buffer" | "window" | "summary" | "vector";

/** 向量记忆条目 */
export interface VectorEntry {
    text: string;
    vector: number[];
    metadata: { user: string; assistant: string };
}

/** 会话 */
export interface Session {
    id: string;
    messages: BaseMessage[];
    createdAt: number;
    messageCount: number;
    currentTemplate?: string;
    /** 记忆策略（默认 buffer） */
    memoryStrategy: MemoryStrategy;
    /** 窗口策略：保留最近几轮（默认 3） */
    windowSize: number;
    /** 摘要策略：压缩后的摘要文本 */
    summary?: string;
    /** 摘要阈值：超过此消息数触发压缩 */
    summaryThreshold: number;
    /** 摘要策略：压缩后保留的最近消息数 */
    recentToKeep: number;
    /** 向量策略：向量存储 */
    vectorEntries: VectorEntry[];
}

const sessions = new Map<string, Session>();

/** 创建新会话 */
export function createSession(id: string): Session {
    const session: Session = {
        id,
        messages: [new SystemMessage(CONFIG.systemPrompt)],
        createdAt: Date.now(),
        messageCount: 0,
        memoryStrategy: "buffer",
        windowSize: 3,
        summaryThreshold: 6,
        recentToKeep: 4,
        vectorEntries: [],
    };
    sessions.set(id, session);
    return session;
}

/** 获取会话 */
export function getSession(id: string): Session | undefined {
    return sessions.get(id);
}

/** 删除会话 */
export function deleteSession(id: string): void {
    sessions.delete(id);
}

/** 添加用户消息 */
export function addUserMessage(session: Session, content: string): void {
    session.messages.push(new HumanMessage(content));
    session.messageCount++;
}

/** 添加 AI 回复 */
export function addAIMessage(session: Session, content: string): void {
    session.messages.push(new AIMessage(content));
}

/** 清空历史（保留系统提示词） */
export function clearHistory(session: Session): void {
    const sys = session.messages.find((m) => m._getType() === "system");
    session.messages = sys
        ? [sys]
        : [new SystemMessage(CONFIG.systemPrompt)];
    session.messageCount = 0;
}
