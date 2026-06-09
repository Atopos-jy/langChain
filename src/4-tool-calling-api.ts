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

// zod 是一个 TypeScript 优先的 schema 声明和验证库。它的核心作用有两个：

// 定义数据的“形状”（类型）
// 例如：一个对象必须有 name（字符串）和 age（数字）。

// 在运行时校验数据
// 保证收到的数据符合你定义的结构，如果不符合会抛出清晰的错误。

// 升级3-tool-calling.ts，封装一个函数用于从 wttr.in API 获取天气数据
async function fetchWeather(location: string): Promise<string> {
    const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
    console.log(`[API 请求] GET ${url}`);

    const res = await fetch(url, {
        headers: { Accept: "application/json" },
    });

    if (!res.ok) {
        return `天气 API 请求失败（HTTP ${res.status}）`;
    }

    const data = await res.json();
    const current = data.current_condition?.[0];

    if (!current) {
        return `${location} 的天气数据暂未收录`;
    }

    const temp = current.temp_C;
    const feelsLike = current.FeelsLikeC;
    const humidity = current.humidity;
    const desc = current.lang_zh?.[0]?.value ?? current.weatherDesc?.[0]?.value;
    const windSpeed = current.windspeedKmph;

    return `${location}：${desc}，气温 ${temp}°C（体感 ${feelsLike}°C），湿度 ${humidity}%，风速 ${windSpeed}km/h`;
}

const getWeatherTool = tool(
    async (input: { location: string }) => {
        console.log(`[工具调用] 获取 ${input.location} 的天气数据...`);
        const result = await fetchWeather(input.location);
        console.log(`[工具返回] ${result}`);
        return result;
    },
    {
        name: "get_weather",
        description:
            "查询指定城市的实时天气情况，当用户询问某个城市的天气时使用",
        schema: z.object({
            location: z.string().describe("城市名称，如北京、上海"),
        }),
    },
);

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
