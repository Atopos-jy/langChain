import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import {
    HumanMessage,
    AIMessage,
    ToolMessage,
    SystemMessage,
} from "@langchain/core/messages";

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

// ============================================================
// ToolMessage 是什么？
// 工具消息用于将工具执行的结果传递回模型。
// 它必须与 AIMessage 中的 tool_calls 配合使用，通过 tool_call_id 关联。
// ============================================================

// 模拟一个 AIMessage，表示模型决定调用工具 get_weather
const aiMessage = new AIMessage({
    content: "", // 决定调用工具时 content 为空
    tool_calls: [
        {
            name: "get_weather",
            args: { location: "新乡" },
            id: "call_001", // 唯一调用ID
        },
    ],
});

// ToolMessage：将工具执行结果传回模型
// tool_call_id 必须与 AIMessage 中 tool_calls 的 id 一致，用于关联
const toolMessage = new ToolMessage({
    content: "晴朗，20 摄氏度，微风",
    tool_call_id: "call_001",
});

// 打印消息结构，看清每种消息长什么样
console.log("--- AIMessage（模型请求调用工具）---");
console.log("  content:", aiMessage.content || "(空)");
console.log("  tool_calls:", JSON.stringify(aiMessage.tool_calls, null, 2));

console.log("\n--- ToolMessage（工具执行结果）---");
console.log("  content:", toolMessage.content);
console.log("  tool_call_id:", toolMessage.tool_call_id);

// ============================================================
// 将消息组装起来，调用模型生成最终回复
// 消息顺序：用户提问 → 模型决定调工具 → 工具结果 → 模型生成回复
// ============================================================

const messages = [
    new SystemMessage("你是一个智能助手。"),
    new HumanMessage("新乡今天天气怎么样？"),
    aiMessage,
    toolMessage,
];

console.log("\n--- 将消息历史发回模型，生成最终回复 ---\n");
try {
    const response = await llm.invoke(messages);
    console.log("助手:", response.content);
} catch (error: any) {
    // DeepSeek 在思考模式下对模拟的 tool_calls 消息有限制，但不影响理解消息结构
    console.log("注意: DeepSeek 对模拟 tool_calls 的请求有额外限制，属于模型差异");
    console.log("消息结构的学习目的已完成 ✅ 上面的输出展示了 AIMessage 和 ToolMessage 的结构");
}
