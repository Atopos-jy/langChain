import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config();

const llm = new ChatOpenAI({
    model: "mimo-v2.5-pro",
    apiKey: process.env.MiMo_API_KEY,
    temperature: 0.7,
    streamUsage: false,
    configuration: {
        baseURL: "https://token-plan-ams.xiaomimimo.com/v1",
    },
});
// 使用 batch 方法并发批量调用大模型，maxConcurrency 控制最大并发数
// 因为大模型的调用是异步的，所以可以并发调用多个请求，问题比较多，返回的响应会随机排序
const responses = await llm.batch(
    [
        "为什么鹦鹉的羽毛是彩色的？",
        "飞机是怎么飞的？",
        "什么是量子计算？",
        "为什么天空是蓝色的？",
        "鸟为什么会飞？",
        "什么是agent？",
    ],
    {
        maxConcurrency: 5,
    },
);
// 遍历批量响应，打印每个响应的内容（要等待所有响应返回后再打印）
for (const response of responses) {
    console.log(response.content);
    console.log("----------------------------------");
}
// 思考：这么多问题，如何统一约束回答风格，比如都用中文回答，都用英文回答，简要回答等
// 可以在每个问题前添加一个系统提示，约束回答风格，比如：
// const systemPrompt = "你是一个智能助手，请用一句话简要回答用户的问题。";
// const questions = [
//   "为什么鹦鹉的羽毛是彩色的？",
//   "飞机是怎么飞的？",
//   "什么是量子计算？",
//   "为什么天空是蓝色的？",
//   "鸟为什么会飞？",
//   "什么是agent？",
// ];

// const responses = await llm.batch(
//   questions.map((q) => [
//     { role: "system" as const, content: systemPrompt },
//     { role: "user" as const, content: q },
//   ]),
//   { maxConcurrency: 5 }
// );
