import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { tool, StructuredTool } from "@langchain/core/tools";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
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
// Tool Calling Agent：基于工具调用的 Agent
//
// 与 ReAct 的区别：
//   - ReAct 靠 Prompt 引导模型输出结构化文本，再手动解析
//   - Tool Calling 利用 LLM 原生的 Function Calling 能力，
//     模型直接输出结构化的工具调用请求，无需文本解析
//
// 工作流程：
//   1. 定义工具（名称、描述、参数 schema）
//   2. 将工具绑定到 LLM（bindTools）
//   3. LLM 分析用户请求，决定是否调用工具
//   4. 执行工具，将结果返回给 LLM
//   5. LLM 基于工具结果生成最终回答
// ============================================================

// ---------- 定义工具 ----------

const searchTool = tool(
  async ({ query }: { query: string }) => {
    const results: Record<string, string> = {
      "北京天气": "北京今天晴，25°C，微风",
      "上海天气": "上海多云，28°C，东南风3级",
      "langchain": "LangChain 是一个用于构建 LLM 应用的框架，支持链式调用、Agent、RAG 等",
    };
    // 分词匹配：将 key 按字切分，检查 query 是否包含所有字符
    const matched = Object.entries(results).find(([key]) => {
      const chars = key.split("");
      return chars.every((c) => query.includes(c));
    });
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

const tools = [searchTool, calculatorTool];
// 为工具创建一个名称到工具的映射，方便后续根据工具名称调用工具
const toolsByName: Record<string, (typeof tools)[number]> = Object.fromEntries(
  tools.map((t) => [t.name, t])
);

// ---------- 绑定工具到 LLM ----------
const llmWithTools = llm.bindTools(tools);

// ---------- Agent 执行循环 ----------
async function runToolCallingAgent(
  question: string,
  maxIterations: number = 5
): Promise<string> {
  // 初始化消息历史，包含用户问题
  const messages: any[] = [new HumanMessage(question)];

  // 进入循环，把 messages 发给 LLM 处理，直到没有工具调用请求
  for (let i = 0; i < maxIterations; i++) {
    // 模型本身的 function calling 能力，直接输出结构化的工具调用请求
    const response = await llmWithTools.invoke(messages);

    // 如果模型没有请求调用工具，说明已经有最终答案，返回最终答案，结束循环
    if (!response.tool_calls || response.tool_calls.length === 0) {
      return typeof response.content === "string"
        ? response.content
        : String(response.content);
    }

    console.log(`第 ${i + 1} 轮迭代`);
    // 将模型响应加入消息历史
    messages.push(response);

    // 执行每一个工具调用
    for (const toolCall of response.tool_calls) {
      const selectedTool = toolsByName[toolCall.name];
      if (!selectedTool) {
        messages.push(
          new ToolMessage({
            content: `错误：找不到工具 "${toolCall.name}"`,
            tool_call_id: toolCall.id!,
          })
        );
        continue;
      }
      // 调用工具，获取结果
      const result = await (selectedTool as StructuredTool).invoke(toolCall.args);
      console.log(
        `  🔧 调用工具: ${toolCall.name}(${JSON.stringify(toolCall.args)}) →  结果： ${result}`
      );
      // 将工具调用结果加入消息历史，然后继续下一次迭代，回到 99 行继续处理，返回最终答案
      messages.push(
        new ToolMessage({
          content: result,
          tool_call_id: toolCall.id!,
        })
      );
    }
  }
  return "达到最大迭代次数，未能生成最终回答";
}

// ---------- 执行 ----------
// const question = "你好";  // 不调用工具，直接返回最终答案
const question = "北京今天天气怎么样？适合出门吗？"; // 调用 searchTool 工具

console.log(`问题：${question}\n`);
console.log("开始 Tool Calling Agent...\n");

const answer = await runToolCallingAgent(question);
console.log(`\n最终答案：${answer}`);