import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

dotenv.config();

const llm = new ChatOpenAI({
    model: "mimo-v2.5-pro",
    apiKey: process.env.MiMo_API_KEY,
    temperature: 0.7,
    streamUsage: false,
    configuration: {
        baseURL: "https://token-plan-ams.xiaomimimo.com/v1",
    },
});

// 标准消息格式调用
const conversation = [
    // 系统消息
    new SystemMessage(
        "你是一个智能助手，你会根据用户的问题回答用户的问题，直接回答不知道.",
    ),
    // 用户消息
    new HumanMessage("世界上最高的山峰是哪座？"),
];

// 助手消息（invoke是异步方法，用来调用大模型）
const aiMsg = await llm.invoke(conversation);
// 打印 AIMessage 对象（包含消息ID、回复内容、响应元数据、Token用量、工具调用等完整信息）
console.log("助手消息:", aiMsg);
// 打印回复内容
console.log("助手回复:", aiMsg.content);
// 打印 Token 用量（包含输入Token、输出Token、总Token及详细明细）
console.log("Token 用量:", aiMsg.usage_metadata);
