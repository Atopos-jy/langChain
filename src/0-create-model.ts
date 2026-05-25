import dotenv from "dotenv"; // 加载环境变量中的模型 API 密钥
import { ChatOpenAI } from "@langchain/openai";

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

// 打印创建大模型对象
// console.log(llm);
// 主要组成
console.log("模型名称:", llm.model); // 模型名称
console.log("API Key:", llm.apiKey); // API Key
console.log("温度参数:", llm.temperature); // 温度参数
console.log("流式调用参数:", llm.streamUsage); // 流式调用参数
console.log("等等"); // 其他参数

export default llm;
