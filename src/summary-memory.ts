import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

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

const parser = new StringOutputParser();

// ============================================================
// 案例三：Summary Memory — 对话摘要
//
// 当对话历史超过阈值时，用 LLM 将旧历史压缩为摘要，
// 再将「摘要 + 最近几轮原始对话」拼接后发给 LLM。
//
// 与前两种策略的对比：
//   Buffer：全部保留 → Token 线性增长
//   Window：只保留最近 → 早期信息完全丢失
//   Summary：压缩旧历史为摘要 → 保留关键信息 + Token 可控
//
// 优点：
//   - Token 增长缓慢（摘要远短于原始对话）
//   - 保留了早期对话的关键信息，不会完全「失忆」
//
// 缺点：
//   - 摘要过程会丢失细节（「他说了什么」变成「他聊了某话题」）
//   - 每次压缩需要额外调用一次 LLM，增加延迟和成本
//   - 摘要质量取决于 LLM 的能力
//
// 适用场景：长期对话助手、客服系统、需要跨多轮保持上下文的场景
//
// 实现方式：
//   - SUMMARIZE_THRESHOLD：当历史消息超过此数量时触发摘要
//   - 摘要时：将旧消息 + 之前的摘要 发送给 LLM 压缩
//   - 拼接时：[系统提示, 摘要消息, 最近 K 轮原始对话]
// ============================================================

// 摘要阈值，超过此数量时触发摘要压缩
const SUMMARIZE_THRESHOLD = 6;
const RECENT_MESSAGES_TO_KEEP = 4;

// 对话历史记录，用于存储所有对话消息
const chatHistory = new InMemoryChatMessageHistory();
let currentSummary = "";

// 摘要压缩提示模板
const summaryPrompt = PromptTemplate.fromTemplate(`
请将以下对话历史压缩为一段简洁的摘要，保留所有关键信息（人名、偏好、决策、重要事实等）。

{previous_summary}

对话历史：
{history}

请输出压缩后的摘要（只输出摘要内容，不要加任何前缀）：
`);

// 系统提示
const systemPrompt = new SystemMessage(
  "你是一个友好的 AI 助手。请根据对话摘要和最近的对话内容回答用户的问题。"
);

function formatMessages(messages: BaseMessage[]): string {
  return messages
    .map((msg) => {
      const role =
        msg instanceof HumanMessage
          ? "用户"
          : msg instanceof AIMessage
            ? "助手"
            : "系统";
      const content =
        typeof msg.content === "string" ? msg.content : String(msg.content);
      return `${role}：${content}`;
    })
    .join("\n");
}

// 压缩对话历史为摘要
async function summarizeHistory(messages: BaseMessage[]): Promise<string> {
  const historyText = formatMessages(messages);
  const chain = summaryPrompt.pipe(llm).pipe(parser);

  console.log("\n📝 正在压缩对话历史为摘要...");
  const summary = await chain.invoke({
    previous_summary: currentSummary
      ? `之前的摘要：${currentSummary}\n`
      : "",
    history: historyText,
  });

  return summary;
}

// 处理用户输入
async function chat(userInput: string): Promise<string> {
  await chatHistory.addUserMessage(userInput);

  const allHistory = await chatHistory.getMessages();

  if (allHistory.length >= SUMMARIZE_THRESHOLD) {
    const oldMessages = allHistory.slice(0, allHistory.length - RECENT_MESSAGES_TO_KEEP);
    const recentMessages = allHistory.slice(allHistory.length - RECENT_MESSAGES_TO_KEEP);

    const newSummary = await summarizeHistory(oldMessages);
    console.log(`   摘要结果：${newSummary.slice(0, 80)}${newSummary.length > 80 ? "..." : ""}`);

    currentSummary = newSummary;
    await chatHistory.clear();
    await chatHistory.addMessages(recentMessages);

    console.log(`   ✅ 压缩完成：${allHistory.length} 条消息 → 摘要 + ${recentMessages.length} 条近期消息`);
  }

  const recentHistory = await chatHistory.getMessages();

  const summaryMessage = currentSummary
    ? new SystemMessage(`之前的对话摘要：${currentSummary}`)
    : null;

  const messages: BaseMessage[] = [
    systemPrompt,
    ...(summaryMessage ? [summaryMessage] : []),
    ...recentHistory,
  ];

  console.log(`\n📤 发送给 LLM 的消息数：${messages.length}（1 系统提示 + ${currentSummary ? "1 摘要 + " : ""}${recentHistory.length} 条历史）`);
  if (currentSummary) {
    console.log(`   摘要内容：${currentSummary.slice(0, 60)}${currentSummary.length > 60 ? "..." : ""}`);
  }

  const response = await llm.invoke(messages);
  const reply =
    typeof response.content === "string"
      ? response.content
      : String(response.content);

  await chatHistory.addAIMessage(reply);

  return reply;
}

async function main() {
  console.log("=== 案例三：Summary Memory（对话摘要）===\n");
  console.log(`策略：历史超过 ${SUMMARIZE_THRESHOLD} 条消息时，压缩旧历史为摘要`);
  console.log("观察：早期对话被压缩为摘要，关键信息得以保留\n");

  const questions = [
    "你好，我叫张三",
    "我是一名前端工程师，住在北京",
    "我喜欢打篮球和弹吉他",
    "我是做什么工作的？住在哪里？",
    "我的爱好是什么？",
    "你还记得我叫什么名字吗？",
  ];

  for (const question of questions) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`👤 用户：${question}`);

    const reply = await chat(question);
    console.log(`🤖 助手：${reply}`);
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log("总结：Summary Memory 将旧历史压缩为摘要");
  console.log("相比 Window Memory，早期关键信息得以保留");
  console.log("但细节会有丢失，且压缩过程需要额外的 LLM 调用");
}

main().catch(console.error);
