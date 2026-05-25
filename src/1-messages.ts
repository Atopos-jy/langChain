import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import {
    HumanMessage,
    SystemMessage,
    AIMessage,
} from "@langchain/core/messages";

dotenv.config();

const llm = new ChatOpenAI({
    model: "mimo-v2.5-pro",
    apiKey: process.env.MiMo_API_KEY,
    temperature: 0.7,
    streamUsage: false,
    timeout: 30000, // 30秒超时，避免无限等待
    configuration: {
        baseURL: "https://token-plan-ams.xiaomimimo.com/v1",
    },
});

// 多轮对话示例：通过注入历史消息，让模型记住之前的对话上下文
const systemMsg = new SystemMessage("你是一个有用的智能助手！");
const humanMsg1 = new HumanMessage("我叫小军，请问明朝什么时候建立?");
const aiMessage = new AIMessage("明朝建立于**1368年**。"); // 手动模拟上一轮 AI 的回复
const humanMsg2 = new HumanMessage("我叫什么名字，刚刚我问的问题是什么?");

// 将完整的消息历史按顺序组装，模型会基于全部上下文进行回复
const messages = [systemMsg, humanMsg1, aiMessage, humanMsg2];
const response = await llm.invoke(messages);
console.log(response.content);

// 也可以直接传原始对象数组（效果与上面使用消息类完全相同）
const rawMessages = [
    { role: "system" as const, content: "你是一个诗人" },
    { role: "user" as const, content: "写一首关于春天的俳句" },
];
const poemResponse = await llm.invoke(rawMessages);
console.log("\n--- 原始对象写法 ---");
console.log(poemResponse.content);
