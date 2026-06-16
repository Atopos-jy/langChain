// ============================================================
// 四种记忆策略的实现
//
// 原理：所有历史消息都保存在 session.messages 中，
//       但在发给 LLM 之前，根据策略做不同的"加工"：
//
//   buffer  → 全部发出
//   window  → 只取最近 K 轮
//   summary → 旧历史压缩为摘要 + 最近几轮原文
//   vector  → 语义检索相关历史 + 最近几轮原文
// ============================================================

import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { llm } from "./llm";
import type { Session, VectorEntry } from "./session";

// ============================================================
// 1. Buffer — 全部历史
// ============================================================

function bufferContext(session: Session): BaseMessage[] {
    return session.messages;
}

// ============================================================
// 2. Window — 滑动窗口
// ============================================================

function windowContext(session: Session): BaseMessage[] {
    const maxMessages = session.windowSize * 2; // 每轮 = user + ai = 2 条
    const all = session.messages;

    if (all.length <= maxMessages + 1) return all; // +1 是 system prompt

    // [system, ...最近 N 条]
    return [all[0], ...all.slice(-maxMessages)];
}

// ============================================================
// 3. Summary — 对话摘要
// ============================================================

const summaryPrompt = PromptTemplate.fromTemplate(`
请将以下对话历史压缩为一段简洁的摘要，保留所有关键信息（人名、偏好、决策、重要事实等）。

{previous_summary}

对话历史：
{history}

请输出压缩后的摘要（只输出摘要内容，不要加任何前缀）：
`);

const parser = new StringOutputParser();

function formatMessages(messages: BaseMessage[]): string {
    return messages
        .map((msg) => {
            const role = msg instanceof HumanMessage ? "用户"
                : msg instanceof AIMessage ? "助手" : "系统";
            const content = typeof msg.content === "string" ? msg.content : String(msg.content);
            return `${role}：${content}`;
        })
        .join("\n");
}

async function summaryContext(session: Session): Promise<BaseMessage[]> {
    const { summaryThreshold, recentToKeep } = session;

    // 不管有没有摘要，都保留最近几条的原文
    const nonSystem = session.messages.slice(1); // 去掉 system
    const recent = nonSystem.slice(-recentToKeep);

    // 触发压缩条件：历史消息超过阈值
    if (nonSystem.length >= summaryThreshold) {
        const oldMessages = nonSystem.slice(0, nonSystem.length - recentToKeep);

        console.log("\n📝 [memory] 正在压缩对话历史为摘要...");
        const historyText = formatMessages(oldMessages);
        const chain = summaryPrompt.pipe(llm).pipe(parser);
        const newSummary = await chain.invoke({
            previous_summary: session.summary ? `之前的摘要：${session.summary}\n` : "",
            history: historyText,
        });

        const prevLen = session.summary?.length || 0;
        session.summary = newSummary;

        // 清理已压缩的消息（保留 system + recent）
        session.messages = [session.messages[0], ...recent];
        // 恢复 user 消息（后续 handler 会再 add）
        // 注意：handler 已经 addUserMessage 了，这里我们不重复处理

        console.log(`   ✅ 压缩完成：${oldMessages.length} 条 → 摘要（${prevLen} → ${newSummary.length} 字符）`);
    }

    // 构建上下文：system + [摘要] + recent
    const context: BaseMessage[] = [session.messages[0]];
    if (session.summary) {
        context.push(new SystemMessage(`之前的对话摘要：${session.summary}`));
    }
    context.push(...recent);

    return context;
}

// ============================================================
// 4. Vector — 向量记忆（本地 TF-IDF）
// ============================================================

/**
 * 本地 TF-IDF Embedding（纯 JS，零依赖）
 * 词频统计 + 逆文档频率加权 → 固定维度向量
 */
class TfIdfEmbedder {
    private vocab = new Map<string, number>();
    private docTf: Map<number, number[]>[] = [];
    private idfCache: number[] | null = null;

    private tokenize(text: string): string[] {
        const tokens: string[] = [];
        const re = /[一-鿿]|[a-zA-Z0-9]+/g;
        for (const match of text.toLowerCase().matchAll(re)) {
            tokens.push(match[0]);
        }
        return tokens;
    }

    private textToTfVec(text: string): number[] {
        const tokens = this.tokenize(text);
        const vec = new Array(this.vocab.size).fill(0);
        for (const token of tokens) {
            let idx = this.vocab.get(token);
            if (idx === undefined) {
                idx = this.vocab.size;
                this.vocab.set(token, idx);
                for (const tf of this.docTf) {
                    for (const [_, tv] of tf) tv.push(0);
                }
                this.idfCache = null;
                vec.push(0);
            }
            vec[idx!]++;
        }
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }

    private addDoc(text: string): number[] {
        const vec = this.textToTfVec(text);
        const map = new Map<number, number[]>();
        for (let i = 0; i < vec.length; i++) {
            if (vec[i] !== 0) map.set(i, [vec[i]]);
        }
        this.docTf.push(map);
        return vec;
    }

    private get idf(): number[] {
        if (this.idfCache) return this.idfCache;
        const n = this.docTf.length;
        const idf = new Array(this.vocab.size).fill(0);
        for (const docMap of this.docTf) {
            for (const idx of docMap.keys()) idf[idx] = (idf[idx] || 0) + 1;
        }
        this.idfCache = idf.map(df => Math.log((n + 1) / (df + 1)) + 1);
        return this.idfCache;
    }

    private embed(text: string): number[] {
        const tokens = this.tokenize(text);
        const vec = new Array(this.vocab.size).fill(0);
        for (const token of tokens) {
            const idx = this.vocab.get(token);
            if (idx !== undefined) vec[idx]++;
        }
        const idf = this.idf;
        for (let i = 0; i < vec.length; i++) {
            if (vec[i] > 0) vec[i] = (1 + Math.log(vec[i])) * idf[i];
        }
        const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
        return vec.map(v => v / norm);
    }

    vectorize(text: string): number[] {
        if (this.vocab.size === 0) return this.addDoc(text);
        return this.embed(text);
    }

    /** 余弦相似度 */
    cosineSimilarity(a: number[], b: number[]): number {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
}

/** 全局 TF-IDF embedder（所有会话共享词汇表） */
const embedder = new TfIdfEmbedder();

/** 将对话存入向量库 */
export function addToVectorStore(session: Session, userMsg: string, assistantReply: string) {
    const text = `用户：${userMsg}`;
    const vector = embedder.vectorize(text);
    session.vectorEntries.push({
        text,
        vector,
        metadata: { user: userMsg, assistant: assistantReply },
    });
}

/** 检索最相关的 K 条历史 */
function retrieveRelevant(session: Session, query: string, topK: number): VectorEntry[] {
    if (session.vectorEntries.length === 0) return [];
    const qVec = embedder.vectorize(query);
    const scored = session.vectorEntries
        .map(entry => ({ entry, score: embedder.cosineSimilarity(qVec, entry.vector) }))
        .sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => s.entry);
}

function vectorContext(session: Session, userInput: string): BaseMessage[] {
    const topK = 2;
    const relevant = retrieveRelevant(session, userInput, topK);

    // 最近几轮（取 4 条）
    const nonSystem = session.messages.slice(1);
    const recent = nonSystem.slice(-4);

    // 构建上下文：system + [检索结果] + recent
    const context: BaseMessage[] = [session.messages[0]];

    if (relevant.length > 0) {
        const memoryText = relevant
            .map(m => `用户：${m.metadata.user}\n助手：${m.metadata.assistant}`)
            .join("\n---\n");
        context.push(new SystemMessage(`以下是从历史对话中检索到的相关记忆：\n${memoryText}`));
        console.log(`\n🔍 [memory] 语义检索到 ${relevant.length} 条相关历史`);
    } else {
        console.log("\n🔍 [memory] 语义检索：无相关历史");
    }

    context.push(...recent);
    return context;
}

// ============================================================
// 对外入口
// ============================================================

/**
 * 根据会话的记忆策略，构建发送给 LLM 的消息列表
 * @param session 会话（mutated：summary 策略可能修改 session.messages）
 * @param userInput 用户当前输入（仅在 vector 策略时用到）
 */
export async function getContextMessages(
    session: Session,
    userInput?: string,
): Promise<BaseMessage[]> {
    switch (session.memoryStrategy) {
        case "buffer":
            return bufferContext(session);
        case "window":
            return windowContext(session);
        case "summary":
            return await summaryContext(session);
        case "vector":
            return vectorContext(session, userInput || "");
        default:
            return session.messages;
    }
}

/** 记忆策略的中文名称 */
export function strategyLabel(strategy: string): string {
    const labels: Record<string, string> = {
        buffer: "Buffer（完整对话历史）",
        window: "Window（滑动窗口）",
        summary: "Summary（对话摘要）",
        vector: "Vector（向量记忆）",
    };
    return labels[strategy] || strategy;
}
