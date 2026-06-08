import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";

dotenv.config();

const llm = new ChatOpenAI({
    model: "deepseek-v4-flash",
    apiKey: process.env.DEEPSEEK_API_KEY,
    temperature: 0.7,
    streamUsage: false,
    configuration: {
        baseURL: "https://api.deepseek.com",
    },
});

// 直接调用invoke方法，传入消息数组
const aiMsg = await llm.invoke([
    {
        role: "system",
        content:
            "你是一个智能助手，你会根据用户的问题回答用户的问题，直接回答不知道.",
    },
    {
        role: "user",
        content: "世界上最高的山峰是哪座？",
    },
]);
// 打印 AIMessage 对象（包含消息ID、回复内容、响应元数据、Token用量、工具调用等完整信息）
console.log("助手消息:", aiMsg);
// 打印回复内容
console.log("助手回复:", aiMsg.content);
