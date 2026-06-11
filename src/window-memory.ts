import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import {
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

// ============================================================
// 案例二：Window Memory — 滑动窗口
//
// 只保留最近 K 轮对话，超出窗口的历史消息被丢弃。
//
// 与 Buffer Memory 的对比：
//   Buffer：保存全部历史 → Token 线性增长 → 可能超出上下文窗口
//   Window：只保留最近 K 轮 → Token 固定上限 → 不会超出窗口
//
// 优点：
//   - Token 消耗可控，始终在固定范围内
//   - 实现简单，只需切片操作
//
// 缺点：
//   - 早期对话内容被完全丢弃，不是「遗忘」而是「删除」
//   - 如果关键信息在早期对话中，模型会「失忆」
//
// 适用场景：闲聊机器人、不需要长期记忆的对话场景
//
// 实现方式：
//   维护一个完整的 InMemoryChatMessageHistory，
//   每次调用 LLM 时，只取最近 K 轮（2K 条消息）拼接到 prompt 中。
// ============================================================

const WINDOW_SIZE = 3;

const chatHistory = new InMemoryChatMessageHistory();

const systemPrompt = new SystemMessage(
  "你是一个友好的 AI 助手。请根据提供的对话历史回答用户的问题。"
);

function getRecentMessages(
  allMessages: BaseMessage[],
  windowSize: number
): BaseMessage[] {
  const maxMessages = windowSize * 2;
  if (allMessages.length <= maxMessages) {
    return allMessages;
  }
  return allMessages.slice(allMessages.length - maxMessages);
}

async function chat(userInput: string): Promise<string> {
  await chatHistory.addUserMessage(userInput);

  const allHistory = await chatHistory.getMessages();
  const recentMessages = getRecentMessages(allHistory, WINDOW_SIZE);

  const messages: BaseMessage[] = [systemPrompt, ...recentMessages];

  console.log(`\n📤 发送给 LLM 的消息数：${messages.length}（1 系统提示 + ${recentMessages.length} 条历史，窗口 ${WINDOW_SIZE} 轮）`);
  console.log(`   完整历史 ${allHistory.length} 条，截取最近 ${recentMessages.length} 条`);

  const response = await llm.invoke(messages);
  const reply =
    typeof response.content === "string"
      ? response.content
      : String(response.content);

  await chatHistory.addAIMessage(reply);

  return reply;
}

async function main() {
  console.log("=== 案例二：Window Memory（滑动窗口）===\n");
  console.log(`策略：只保留最近 ${WINDOW_SIZE} 轮对话，超出窗口的历史被丢弃`);
  console.log("观察：发送给 LLM 的消息数有上限，但早期信息会丢失\n");

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

    const allHistory = await chatHistory.getMessages();
    console.log(`\n📊 完整历史：${allHistory.length} 条`);
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(`总结：Window Memory 只保留最近 ${WINDOW_SIZE} 轮对话`);
  console.log("发送给 LLM 的消息数始终 ≤ 6（2 × 窗口大小）");
  console.log("但早期对话内容（如用户的名字）会被丢弃，导致「失忆」");
}

main().catch(console.error);
