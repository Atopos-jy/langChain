import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
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
// ReAct 模式：Reasoning + Acting
//
// 核心思想：模型先思考（Reasoning），再行动（Acting），
//          观察结果后继续推理，形成闭环
//
// 典型流程：
//   Thought: 我需要查找今天的天气
//   Action: search_weather("北京")
//   Observation: 北京今天晴，25°C
//   Thought: 我已经知道天气了，可以回答用户
//   Final Answer: 北京今天晴，25°C
// ============================================================

// ---------- 定义工具（模拟） ----------
interface Tool {
    name: string;
    description: string;
    execute: (input: string) => Promise<string>;
}

const tools: Tool[] = [
    {
        name: "search",
        description: "搜索网络信息",
        execute: async (query: string) => {
            // 模拟搜索结果
            const results: Record<string, string> = {
                北京天气: "北京今天晴，25°C，微风",
                上海天气: "上海多云，28°C，东南风3级",
                闭包: "闭包是JavaScript中的重要概念，函数可以记住并访问其词法作用域",
            };
            const matched = Object.entries(results).find(([key]) => {
                const chars = key.split("");
                return chars.every((c) => query.includes(c));
            });
            console.log(`天气搜索工具结果：${matched?.[1] || ""}`);
            return matched ? matched[1] : `未找到关于"${query}"的信息`;
        },
    },
    {
        name: "calculate",
        description: "数学计算",
        execute: async (expression: string) => {
            try {
                // 安全起见，只允许简单数学运算
                const result = Function(
                    `"use strict"; return (${expression})`,
                )();
                console.log(`计算工具结果：${result}`);
                return `${expression} = ${result}`;
            } catch {
                return `无法计算: ${expression}`;
            }
        },
    },
];

// ---------- ReAct Prompt ----------
const reactPrompt = PromptTemplate.fromTemplate(`
你是一个智能助手，必须使用工具来回答问题。严禁凭空编造信息。

可用工具：
{tools}

请严格按以下格式回答，必须先使用工具获取信息，禁止跳过：

Question: 用户的问题
Thought: 我需要使用工具来获取信息
Action: 工具名称[输入参数]
Observation: （等待工具返回结果，不要自己填写）
Thought: 根据工具返回的结果，我现在可以回答了
Final Answer: 基于工具结果的最终答案

重要规则：
1. 必须先执行 Action 调用工具，禁止直接给出 Final Answer
2. Observation 由系统填写，不要自己编造
3. 只有在获得工具结果后才能给出 Final Answer

现在开始：

Question: {question}
Thought: `);

// ---------- 执行工具调用 ----------
async function executeTool(toolName: string, input: string): Promise<string> {
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
        return `错误：找不到工具"${toolName}"`;
    }
    return await tool.execute(input);
}

// ---------- 解析并执行 ReAct 循环 ----------
async function runReAct(
    question: string,
    maxSteps: number = 5,
): Promise<string> {
    let context = "";
    let step = 0;

    while (step < maxSteps) {
        // 构建当前思考
        const prompt = await reactPrompt.format({
            tools: tools.map((t) => `${t.name}: ${t.description}`).join("\n"),
            question,
        });

        // 调用模型获取下一步
        const response = await llm.invoke(prompt + context);
        const text =
            typeof response.content === "string"
                ? response.content
                : String(response.content);

        // 检查是否有最终答案
        if (text.includes("Final Answer:")) {
            const finalAnswer = text.split("Final Answer:")[1].trim();
            return finalAnswer;
        }

        // 解析 Action
        const actionMatch = text.match(/Action:\s*(\w+)\[(.*?)\]/);
        if (actionMatch) {
            const [, toolName, input] = actionMatch;
            const observation = await executeTool(toolName, input);

            // 更新上下文
            context += `\n${text}\nObservation: ${observation}`;
            step++;
        } else {
            // 如果没有 Action，可能模型直接给出了答案
            return text;
        }
    }

    return "达到最大思考步骤，未能得出最终答案";
}

// ---------- 执行 ----------
const question = "北京今天天气怎么样？";
console.log(`问题：${question}\n`);
console.log("开始 ReAct 推理...\n");

const answer = await runReAct(question);
console.log(`最终答案：${answer}`);
