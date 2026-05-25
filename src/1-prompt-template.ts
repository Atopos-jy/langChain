import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";

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

// ============================================================
// 什么是 PromptTemplate？
// 把 Prompt 拆成：模板（结构） + 参数（数据）
// 这样模板和数据分离，便于复用和维护(有点像前端的模板字符串)
// ============================================================

const prompt = PromptTemplate.fromTemplate(`
你是一个{role}。
请用不超过{limit}字回答以下问题：
{question}
`);

// 使用 format 注入数据，生成最终的提示词字符串
const promptStr = await prompt.format({
    role: "前端面试官",
    limit: "50",
    question: "什么是闭包",
});

console.log("--- 生成的提示词 ---");
console.log(promptStr);

// 将生成的提示词发给模型
const res = await llm.invoke(promptStr);
console.log("--- 模型回复 ---");
console.log(res.content);

// 同一个模板，切换角色和问题即可复用，无需复制 prompt
const promptStr2 = await prompt.format({
    role: "后端面试官",
    limit: "100",
    question: "什么是事务",
});

console.log("\n--- 复用模板，切换后端角色和提示词 ---");
console.log(promptStr2);

console.log("--- 模型回复 ---");
const res2 = await llm.invoke(promptStr2);
console.log(res2.content);
