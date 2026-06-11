import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";

dotenv.config();

const llm = new ChatOpenAI({
  model: "deepseek-v4-flash",
  apiKey: process.env.DEEPSEEK_API_KEY,
  temperature: 0.7,
  streamUsage: false,
  timeout: 30000,
  maxRetries: 2,
  configuration: {
    baseURL: "https://api.deepseek.com",
  },
});

// 向量模型（用于将文本转换为向量表示）
// DeepSeek 暂不支持 embeddings，此处保留 Qwen 的 embeddings 配置
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-v2",
  apiKey: process.env.QWEN_API_KEY,
  configuration: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
});

// ============================================================
// 案例四：Vector Memory — 向量记忆
//
// 将每轮对话向量化存储，当用户提问时，通过语义检索
// 找出与当前问题最相关的历史对话，而非简单地取最近的。
//
// 与前三种策略的对比：
//   Buffer：全部保留 → Token 线性增长
//   Window：只保留最近 → 早期信息丢失
//   Summary：压缩旧历史 → 细节丢失
//   Vector：语义检索 → 按相关性召回，不按时间
//
// 优点：
//   - 不受对话长度限制，可以存储大量历史
//   - 按语义相关性检索，而非按时间顺序
//   - 能「回忆起」很久以前的相关对话
//
// 缺点：
//   - 需要 Embedding 模型，增加成本
//   - 语义检索可能遗漏上下文（只返回片段，缺乏连贯性）
//   - 实现复杂度较高
//
// 适用场景：长期个人助手、知识库问答、需要跨大量历史检索的场景
//
// 实现方式：
//   - 每轮对话结束后，将对话片段向量化存入内存向量库
//   - 用户提问时，先用 Embedding 检索最相关的 K 条历史
//   - 将检索结果 + 最近几轮对话 + 用户问题一起发给 LLM
// ============================================================

interface VectorEntry {
  text: string;
  vector: number[];
  metadata: { type: "exchange"; user: string; assistant: string };
}

// 向量库（用数组存储，生产环境一般会用数据库）
const vectorStore: VectorEntry[] = [];

const chatHistory = new InMemoryChatMessageHistory();

const RETRIEVE_TOP_K = 2;

// 计算余弦相似度 ，范围 [0, 1]
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 添加对话到向量库
// 仅对用户消息向量化，避免 AI 长回复稀释关键信息
async function addConversationToVectorStore(
  userMessage: string,
  assistantReply: string
) {
  const text = `用户：${userMessage}`;
  const vector = await embeddings.embedQuery(text);

  vectorStore.push({
    text,
    vector,
    metadata: { type: "exchange", user: userMessage, assistant: assistantReply },
  });

  console.log(`\n💾 向量库已存储第 ${vectorStore.length} 条对话（仅对用户消息向量化，避免 AI 长回复稀释关键信息）`);
}

// 从向量库中检索最相关的 K 条历史
// 按余弦相似度排序，高到低
// 返回最相关的 K 条历史
async function retrieveRelevantMemories(
  query: string,
  topK: number
): Promise<VectorEntry[]> {
  if (vectorStore.length === 0) return [];

  const queryVector = await embeddings.embedQuery(query);

  const scored = vectorStore.map((entry) => ({
    entry,
    score: cosineSimilarity(queryVector, entry.vector),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((s) => s.entry);
}

const systemPrompt = new SystemMessage(
  "你是一个友好的 AI 助手。请根据检索到的相关历史对话和最近的对话内容来回答用户的问题。"
);

async function chat(userInput: string): Promise<string> {

  // 从向量库中检索最相关的 K 条历史
  const relevantMemories = await retrieveRelevantMemories(
    userInput,
    RETRIEVE_TOP_K
  );

  // 打印检索到的相关历史
  if (relevantMemories.length > 0) {
    console.log(`\n🔍 语义检索到 ${relevantMemories.length} 条相关历史：`);
    relevantMemories.forEach((mem, i) => {
      console.log(
        `   [${i + 1}] ${mem.text.slice(0, 60)}${mem.text.length > 60 ? "..." : ""}`
      );
    });
  } else {
    console.log("\n🔍 语义检索：无相关历史");
  }

  // 构建上下文消息
  const memoryContext = relevantMemories.length > 0
    ? new SystemMessage(
        `以下是从历史对话中检索到的相关记忆：\n${relevantMemories.map((m) => `用户：${m.metadata.user}\n助手：${m.metadata.assistant}`).join("\n---\n")}`
      )
    : null;

  // 获取最近几轮对话（可以使用滑动窗口策略保留最近的 N 条，这样会更符合实际对话场景，更准确）
  // const recentHistory = await chatHistory.getMessages();

  const messages: BaseMessage[] = [
    systemPrompt,
    ...(memoryContext ? [memoryContext] : []),
    // ...recentHistory.slice(-5), // 最近 5 条对话
    new HumanMessage(userInput),
  ];

  console.log(`\n📤 发送给 LLM 的消息数：${messages.length}`);

  const response = await llm.invoke(messages);
  const reply =
    typeof response.content === "string"
      ? response.content
      : String(response.content);

  await chatHistory.addUserMessage(userInput);
  await chatHistory.addAIMessage(reply);

  await addConversationToVectorStore(userInput, reply);

  return reply;
}

async function main() {
  console.log("=== 案例四：Vector Memory（向量记忆）===\n");
  console.log("策略：将对话向量化存储，按语义检索相关历史");
  console.log("观察：即使早期对话距今较远，只要语义相关就能被召回\n");

  const questions = [
    "你好，我叫张三",
    "我是一名前端工程师，住在北京",
    "我最近在学习 React 和 TypeScript",
    "今天天气真好，适合出去玩",
    "你觉得学编程最重要的是什么？",
    "你还记得我的名字吗？我住在哪里？",
    "我最在学React，还有什么？",
  ];

  for (const question of questions) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`👤 用户：${question}`);

    const reply = await chat(question);
    console.log(`🤖 助手：${reply}`);
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log("总结：Vector Memory 按语义相似度检索历史，而非按时间顺序");
  console.log("当用户问「我在学什么技术」时，模型能检索到相关对话");
  console.log("即使中间穿插了其他话题（如天气），也不会被遗漏");
}

main().catch(console.error);
