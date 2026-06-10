import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

dotenv.config();

const llm = new ChatOpenAI({
    model: "deepseek-v4-flash",
    apiKey: process.env.DEEPSEEK_API_KEY,
    temperature: 0.7,
    streamUsage: false,
    timeout: 30000, // 30秒超时，避免无限等待
    configuration: {
        baseURL: "https://api.deepseek.com",
    },
});

const parser = new StringOutputParser();

// ============================================================
// 为什么需要任务拆解？
//
// 一个复杂任务写在一个 Prompt 里，模型会"注意力分散"：
//   "请详细解释闭包，并总结3个要点"
//   → 解释不够深入（被"总结任务"干扰）
//   → 总结不够精炼（被"解释任务"污染）
//
// 解决方案：Task Decomposition（任务拆解）
// 把一个复杂目标拆成多个单一目标，每个子链只做一件事
// ============================================================

// ---------- 任务 A：详细解释 ----------
const explainPrompt = PromptTemplate.fromTemplate(`
你是一个前端专家，请详细介绍以下概念: {topic}
要求：
1. 包含定义、原理、使用场景
2. 不超过300字
3. 语言通俗易懂
`);

const explainChain = explainPrompt.pipe(llm).pipe(parser);

// ---------- 任务 B：提炼要点 ----------
const summaryPrompt = PromptTemplate.fromTemplate(`
请将以下内容总结为3个核心要点：
要求：
- 每点不超过20字
- 使用短句
- 易记忆

内容：
{explanation}
`);

const summaryChain = summaryPrompt.pipe(llm).pipe(parser);

// ---------- 任务 C：结构化输出 ----------
const formatPrompt = PromptTemplate.fromTemplate(`
请将以下内容整理成结构化格式并直接输出JSON。

解释内容：
{explanation}

总结要点：
{summary}

要求：
- 输出必须是有效的JSON格式
- 包含两个字段：explanation（解释摘要）和highlights（3个要点数组）
- 不要包含任何其他文本或markdown格式
`);

const formatChain = formatPrompt.pipe(llm).pipe(parser);

// ============================================================
// RunnableSequence：把多个 Runnable 串成一条流水线
//
// 执行顺序：input → step1 → step2 → step3 → output
//
// 每一步是一个函数，接收上一步的输出，调用子链处理，返回下一步的输入
// 数据在链中"自动接力"：{ topic } → explanation → summary → JSON
// ============================================================

const fullChain = RunnableSequence.from([
    // Step 1：生成解释
    async (input: { topic: string }) => {
        const explanation = await explainChain.invoke({
            topic: input.topic,
        });
        return { explanation };
    },

    // Step 2：生成总结（基于 explanation）
    async (data: { explanation: string }) => {
        const summary = await summaryChain.invoke({
            explanation: data.explanation,
        });
        return {
            explanation: data.explanation,
            summary,
        };
    },

    // Step 3：结构化输出
    async (data: { explanation: string; summary: string }) => {
        const json = await formatChain.invoke({
            explanation: data.explanation,
            summary: data.summary,
        });
        return json;
    },
]);

// ---------- 执行 ----------
console.log("=".repeat(60));
console.log("🅰️ 方案一：RunnableSequence.from（保留所有中间结果）");
console.log("=".repeat(60));

// 拆开执行，展示每一步的中间值
console.log("\n📌 第一步：生成解释 →");
const step1Result = await explainChain.invoke({ topic: "闭包" });
console.log(`"${step1Result}"`);
console.log(`长度: ${step1Result.length} 字`);

console.log("\n📌 第二步：提炼要点 →（同时保留了第一步的解释）");
const step2Result = await summaryChain.invoke({ explanation: step1Result });

console.log("\n📌 第三步：结构化输出（基于 解释+要点 两份数据）");
const result = await formatChain.invoke({
    explanation: step1Result,
    summary: step2Result,
});

console.log("\n📦 最终输出：");
console.log(JSON.stringify(result, null, 2));

console.log("\n" + "=".repeat(60));
console.log("🅱️ 方案二：pipe 串联（中间结果丢失！）");
console.log("=".repeat(60));

const pipeStep1 = await explainChain.invoke({ topic: "闭包" });
console.log(`\n📌 第一步：生成解释 → "${pipeStep1.slice(0, 30)}..."`);
console.log(`   ✅ 解释已经生成，但 pipe 只会把「值」往下传`);

console.log(`\n📌 第二步：pipe 把解释传给 summaryChain`);
const pipeStep2 = await summaryChain.invoke({ explanation: pipeStep1 });
console.log(`   输出 → "${pipeStep2}"`);
console.log(`   ❌ 注意：到这里，原始的详细解释 EXPLANATION 就被丢了！`);

console.log(`\n📌 第三步：formatChain 只能拿到 summary，没有 explanation`);
const pipeResult = await formatChain.invoke({
    explanation: "（原文已丢失，只能填占位符 😢）",
    summary: pipeStep2,
});

console.log("\n📦 最终输出：");
console.log(JSON.stringify(pipeResult, null, 2));
