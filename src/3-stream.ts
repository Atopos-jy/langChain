import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";

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
// 流式调用大模型
const stream = await llm.stream("世界上最高的山峰是哪座？");

// 处理流式响应
console.log("开始流式响应:");

let full = null;
// for await...of 语法可用于遍历异步可迭代对象，其中 await 确保每次迭代等待数据就绪后再执行循环体
// stream 是 llm.stream() 返回的异步迭代器，chunk 为每次接收到的流式数据片段
// 整体逻辑是遍历流式响应，将每个 chunk 写入标准输出并累加到 full 中
for await (const chunk of stream) {
    // 每次迭代时，将 chunk 写入标准输出，实现流式响应,实时显示,思考一下为什么不能使用 console.log直接打印
    process.stdout.write(chunk.content as string);
    // 累加到 full 中，用于后续打印完整响应
    full = full ? full.concat(chunk) : chunk;
}
// 最后，打印完整响应
console.log("\n\n--- 完整响应 ---");
console.log(full?.content);
