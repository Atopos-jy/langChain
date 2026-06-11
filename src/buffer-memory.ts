import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import * as readline from "readline";

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
// 案例一：Buffer Memory — 完整对话历史
//
// 最简单的记忆策略：把所有对话消息原封不动地保存下来，
// 每次调用 LLM 时，将全部历史拼接到 prompt 中。
//
// 优点：
//   - 实现简单，逻辑清晰
//   - LLM 能看到完整上下文，不会遗漏信息
//
// 缺点：
//   - 对话越长，消息越多，Token 消耗线性增长
//   - 超过模型上下文窗口后会截断或报错
//   - 长对话中早期信息被「遗忘在噪音里」，效果反而下降
//
// 适用场景：短对话、客服单轮会话、简单问答
//
// 核心流程：
//   用户输入 → 取出全部历史 → 拼接为 messages → 发送给 LLM
//           → LLM 回复 → 存入历史 → 返回给用户
// ============================================================

const chatHistory = new InMemoryChatMessageHistory();

const systemPrompt = new SystemMessage(
  "你是一个友好的 AI 助手。请记住用户之前说过的话，在回答时引用之前的对话内容。"
);

async function chat(userInput: string): Promise<string> {
  await chatHistory.addUserMessage(userInput);

  const history = await chatHistory.getMessages();

  const messages: BaseMessage[] = [systemPrompt, ...history];

  console.log(`\n📤 发送给 LLM 的消息数：${messages.length}（1 系统提示 + ${history.length} 条历史）`);
  messages.forEach((msg, i) => {
    const role =
      msg instanceof SystemMessage
        ? "system"
        : msg instanceof HumanMessage
          ? "user"
          : "assistant";
    const content =
      typeof msg.content === "string" ? msg.content : String(msg.content);
    console.log(
      `   [${i}] ${role}: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}`
    );
  });

  const response = await llm.invoke(messages);
  const reply =
    typeof response.content === "string"
      ? response.content
      : String(response.content);

  await chatHistory.addAIMessage(reply);

  return reply;
}

async function main() {
  console.log("=== 案例一：Buffer Memory（完整对话历史）===\n");
  console.log("策略：保存所有对话消息，每次调用 LLM 时全部发送");
  console.log("观察：每轮对话后，发送的消息数会逐渐增加\n");

  const questions = [
    "你好，我叫张三",
    "我是一名前端工程师",
    "你还记得我叫什么名字吗？",
    "我是做什么工作的？",
    "请综合介绍一下我",
  ];

  for (const question of questions) {
    console.log(`\n${"─".repeat(50)}`);
    console.log(`👤 用户：${question}`);

    const reply = await chat(question);
    console.log(`🤖 助手：${reply}`);

    const history = await chatHistory.getMessages();
    console.log(`\n📊 当前历史消息数：${history.length}`);
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log("总结：Buffer Memory 每轮都将全部历史发给 LLM");
  console.log("消息数从 1 → 3 → 5 → 7 → 9 不断增长");
  console.log("优点：有基本的上下文记忆能力，不会遗漏信息");
  console.log("缺点：当对话很长时，Token 成本会线性增加，且可能超出模型上下文窗口");
}

main().catch(console.error);
