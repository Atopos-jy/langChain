import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { createAgent, tool } from "langchain";
import { z } from "zod";

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
// createAgent：LangChain v1.0 的标准 Agent 构建方式
//
// 与手写 react-agent.ts 的对比：
//
//   手写版：
//     - 自己写 Prompt 引导模型输出 Thought/Action/Observation
//     - 自己用正则解析模型输出，提取工具名和参数
//     - 自己维护上下文，注入 Observation
//     → 灵活但脆弱，文本解析容易出错
//
//   createAgent（替代了旧的 createReactAgent）：
//     - 框架自动构建 ReAct 循环（基于 LangGraph StateGraph）
//     - 利用 LLM 原生的 Tool Calling，无需文本解析
//     - 工具调用、结果注入、循环终止全部自动处理
//     - 支持 middleware 扩展（摘要、人类审核、PII 脱敏等）
//     → 更简洁、更可靠、更易维护
//
// 核心参数：
//   - model：语言模型（字符串或模型实例）
//   - tools：工具数组（用 tool() + Zod schema 定义）
//   - systemPrompt：系统提示词（可选，字符串或函数）
// ============================================================

// ---------- 定义工具 ----------
const searchTool = tool(
  async ({ query }: { query: string }) => {
    const results: Record<string, string> = {
      "北京天气": "北京今天晴，25°C，微风",
      "上海天气": "上海多云，28°C，东南风3级",
      "langchain": "LangChain 是一个用于构建 LLM 应用的框架，支持链式调用、Agent、RAG 等",
    };
    const matched = Object.entries(results).find(([key]) => {
      const chars = key.split("");
      return chars.every((c) => query.includes(c));
    });
    console.log(`天气搜索工具结果：${matched?.[1] || ""}`);

    return matched ? matched[1] : `未找到关于"${query}"的信息`;
  },
  {
    name: "search",
    description: "搜索网络信息，获取实时数据",
    schema: z.object({
      query: z.string().describe("搜索关键词"),
    }),
  }
);

const calculatorTool = tool(
  async ({ expression }: { expression: string }) => {
    try {
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
      const result = Function(`"use strict"; return (${sanitized})`)();
      console.log(`计算工具结果：${result}`);
      return `${expression} = ${result}`;
    } catch {
      return `无法计算: ${expression}`;
    }
  },
  {
    name: "calculator",
    description: "执行数学计算",
    schema: z.object({
      expression: z.string().describe("数学表达式，如 2+3*4"),
    }),
  }
);

// ---------- 创建 Agent ----------
const agent = createAgent({
  model: llm,
  tools: [searchTool, calculatorTool],
  systemPrompt: "你是一个智能助手，善于使用工具来回答用户的问题。请用中文回答。",
});

// ---------- 执行 ----------
const question = "北京今天天气怎么样？适合出门吗？"; // 触发天气搜索工具
// const question = "1+2*3-4等于多少"; // 触发计算工具
console.log(`问题：${question}\n`);
console.log("开始 createAgent 推理...\n");

const result = await agent.invoke({
  messages: [{ role: "user", content: question }],
});

const lastMessage = result.messages[result.messages.length - 1];
const answer = typeof lastMessage.content === "string"
  ? lastMessage.content
  : String(lastMessage.content);

console.log(`\n最终答案：${answer}`);