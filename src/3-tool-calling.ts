import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
    HumanMessage,
    AIMessage,
    ToolMessage,
    SystemMessage,
} from "@langchain/core/messages";
import { z } from "zod";

// 第一步：定义天气查询工具
// tool() 函数接收一个执行函数和一个配置对象
// schema 使用 zod 定义参数的类型和描述，模型会根据 schema 自动提取参数
const getWeatherTool = tool(
    async (input: { location: string }) => {
        const weatherData: Record<string, string> = {
            北京: "多云，15°C，空气质量良好",
            上海: "小雨，18°C，有轻微雾霾",
            广州: "晴朗，28°C，适合户外活动",
            深圳: "晴转多云，26°C，湿度60%",
            新乡: "晴朗，20°C，微风",
            成都: "阴天，16°C，有雾",
            杭州: "晴朗，22°C，适宜出行",
            武汉: "多云，19°C，紫外线中等",
        };

        const location = input.location;
        const weather =
            weatherData[location] || "天气数据暂未收录，建议查询其他城市";

        console.log(`[工具调用] 获取 ${location} 的天气数据...`);
        console.log(`[工具返回] ${weather}`);

        return weather;
    },
    {
        name: "get_weather",
        description: "查询指定城市的天气情况，当用户询问某个城市的天气时使用",
        schema: z.object({
            location: z.string().describe("城市名称，如北京、上海"),
        }),
    },
);

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

// 将工具绑定到模型，模型就知道自己拥有 get_weather 工具可以调用
const llmWithTools = llm.bindTools([getWeatherTool]);

// 支持通过命令行参数指定查询的城市，如：tsx src/3-tool-calling.ts 北京
const city = process.argv[2] || "新乡";

const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
    new SystemMessage(
        "你是一个智能助手，你有工具 get_weather 可以查询城市的天气情况。当用户询问天气时，请调用该工具获取准确信息，回答时请用友好、自然的方式表达。",
    ),
    new HumanMessage(`${city}今天天气怎么样？`),
];

async function chat() {
    console.log(`用户: ${city}今天天气怎么样？\n`);

    // 第二步：发送消息，让模型决定是否调用工具
    const response = await llmWithTools.invoke(messages);

    if (response.tool_calls && response.tool_calls.length > 0) {
        // 模型返回了 tool_calls，说明它决定调用工具
        const toolCall = response.tool_calls[0];
        console.log(`\n[模型决定调用工具]: ${toolCall.name}`);
        console.log(`[工具参数]: ${JSON.stringify(toolCall.args)}\n`);

        // 第三步：手动调用工具，拿到执行结果
        const toolResult = await getWeatherTool.invoke(toolCall.args as any);
        console.log(`[工具执行结果]: ${toolResult}\n`);
        // 工具只返回原始数据，还需要模型把它组织成自然语言回复

        // 第四步：将工具结果封装为 ToolMessage，连同之前的消息一起发回模型
        const toolMsg = new ToolMessage({
            content: String(toolResult),
            tool_call_id: toolCall.id || "",
        });

        messages.push(response); // 包含 tool_calls 的 AIMessage
        messages.push(toolMsg); // 包含工具执行结果的 ToolMessage

        // 第五步：模型基于工具结果生成最终的自然语言回复
        console.log("--- 模型正在基于工具结果生成回复 ---\n");
        const finalResponse = await llmWithTools.invoke(messages);
        messages.push(finalResponse);
        console.log("助手:", finalResponse.content);
    } else {
        // 模型没有请求调用工具，直接回复
        console.log("助手:", response.content);
    }
}

chat();
