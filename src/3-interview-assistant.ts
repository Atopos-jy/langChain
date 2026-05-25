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
// 真实项目示例：AI 面试助手
// 通过 PromptTemplate 实现多角色、多风格的面试问答
// 扩展时只需修改模板，核心逻辑不变
// ============================================================

const prompt = PromptTemplate.fromTemplate(`
你是一位严格的{role}。
请用专业且简洁的语言回答：
{question}
限制在{limit}字以内。
`);

const chain = prompt.pipe(llm);

// 前端面试
const res1 = await chain.invoke({
    role: "前端面试官",
    question: "什么是闭包",
    limit: "80",
});

console.log("--- 前端面试 ---");
console.log(res1.content);

// 后端面试：同一个模板，切换角色即可复用
const res2 = await chain.invoke({
    role: "后端面试官",
    question: "什么是微服务架构",
    limit: "80",
});

console.log("\n--- 后端面试 ---");
console.log(res2.content);
