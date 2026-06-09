import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnablePassthrough } from "@langchain/core/runnables";
import {
    StringOutputParser,
    JsonOutputParser,
} from "@langchain/core/output_parsers";

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
// LCEL 完整案例：三节点链（prompt → model → parser）
//
// 前两个示例只用了两节点链（prompt.pipe(llm)）
// llm.invoke() 返回的是 AIMessage 对象，要拿到纯文本还需 .content
//
// 加入 StringOutputParser 后变成三节点链：
//   {topic} → prompt(格式化) → llm(推理) → parser(提取纯文本) → string
//
// 关键点：每个节点都实现了 Runnable 接口（拥有 invoke / stream / batch 方法）
// 所以任何节点都可以被 .pipe() 串联，就像乐高积木一样自由拼接
// ============================================================

const prompt = PromptTemplate.fromTemplate("用一句话解释：{topic}");

//  解析器：将模型输出转换为字符串
const parser = new StringOutputParser();

// const chain = prompt.pipe(llm).pipe(parser);
// 定义一个泛型函数，日志节点不改变数据形状，所以输入输出类型相同
function createLogger<T>(label: string) {
    return new RunnablePassthrough<T>({
        func: (input: T) => {
            console.log(`[${label}] 输入:`, JSON.stringify(input, null, 2));
            return input; // 原样返回，不影响后续节点
        },
    });
}

// 使用方式（假设你的 prompt 期望的输入类型是 { topic: string }）
type ChainInput = { topic: string };

const chain = createLogger<ChainInput>("原始输入")
    .pipe(prompt)
    .pipe(createLogger("prompt 格式化后"))
    .pipe(llm)
    .pipe(createLogger("LLM 原始输出"))
    .pipe(parser)
    .pipe(createLogger("parser 最终输出"));

const result = await chain.stream({ topic: "闭包" });

console.log("类型：", typeof result);
console.log("结果：", result);
for await (const chunk of result) {
    console.log(chunk); // 每次打印模型生成的一小段文本（可能是几个字）
}

// ============================================================
// JsonOutputParser：将模型输出解析为 JSON 对象
// 让模型按照 JSON 格式回复，自动解析为 JavaScript 对象
// ============================================================

const jsonPrompt = PromptTemplate.fromTemplate(`
请以 JSON 格式返回以下语言的三个特性：
语言：{language}
格式：{{"features": ["特性1", "特性2", "特性3"]}}
`);

const jsonParser = new JsonOutputParser();

const jsonChain = jsonPrompt.pipe(llm).pipe(jsonParser);

const jsonResult = await jsonChain.invoke({ language: "TypeScript" });

console.log("\n--- JsonOutputParser ---");
console.log("类型：", typeof jsonResult);
console.log("结果：", jsonResult);
console.log("第一个特性：", jsonResult.features[0]);
