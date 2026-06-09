import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";

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
// 链式调用（LCEL）
//
// 上一个示例中需要手动两步：
//   const promptStr = await prompt.format({ role, limit, question });
//   const res = await llm.invoke(promptStr);
//
// 这种写法的问题：容易忘记调用 format、步骤冗余、不利于组合。
//
// LangChain 提供 .pipe() 方法，可以把多个 Runnable（可执行单元）串联：
//   prompt  →  llm
//   (格式化)   (调用模型)
//
// .pipe() 返回一个新的 Runnable，执行时数据自动从上游流向下游：
//   {role, limit, question}  →  prompt  →  "你是一个前端面试官。..."  →  llm  →  AIMessage
// ============================================================

const prompt = PromptTemplate.fromTemplate(`
你是一个{role}。
请用不超过{limit}字回答以下问题：
{question}
`);

// .pipe() 将 prompt 和 llm 串联成一个新链
// 效果等价于 prompt.format(data) 的结果自动传给 llm.invoke()
const chain = prompt.pipe(llm);

// 一次 invoke，数据依次流过两个节点：
//   1. prompt：把 {role, limit, question} 注入模板 → 生成完整提示词字符串
//   2. llm：接收提示词字符串 → 调用模型 API → 返回 AIMessage
const res = await chain.invoke({
    role: "前端面试官",
    limit: "50",
    question: "什么是闭包",
});

console.log("链式调用结果:", res.content);
