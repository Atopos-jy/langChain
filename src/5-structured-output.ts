import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
// 引入 zod 库，用于定义结构化输出的模式, https://langchainjs.transdocs.org/docs/concepts/structured_outputs/
import { z } from "zod";

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

// 使用 zod 定义电影信息的结构化输出模式，包含标题、年份、导演和评分字段
const Movie = z.object({
    title: z.string().describe("电影的标题"),
    year: z.number().describe("电影的年份"),
    director: z.string().describe("电影的导演"),
    rating: z.number().describe("电影的评分"),
});

// 使用 withStructuredOutput 方法将大模型的输出转换为结构化输出
const modelWithStructure = llm.withStructuredOutput(Movie);

// 调用大模型，获取关于泰坦尼克号电影的评价 JSON 信息
// 结构化输出会自动解析 JSON 字符串，返回一个符合定义的结构化JSON对象
const json = await modelWithStructure.invoke(
    "提供关于泰坦尼克号电影的评价 JSON 信息！",
);

console.log("结构化输出(json)：", json);

// 包含原始数据的结构化输出，方便调试和验证
const modelWithRaw = llm.withStructuredOutput(Movie, { includeRaw: true });
const rawResult = await modelWithRaw.invoke(
    "提供关于泰坦尼克号电影的评价 JSON 信息！",
);

if (rawResult.parsed) {
    console.log("结构化成功:", rawResult.parsed);
} else if (rawResult.raw) {
    // raw 是 BaseMessage 对象，需要取出 content 字符串
    const rawContent = rawResult.raw.content;
    if (typeof rawContent === "string") {
        console.log("原始输出:", rawContent);
        // 清理非法字符：去掉数字后面的“年”字
        //在 LangChain 中，当 includeRaw: true 时，返回的 raw 字段是一个 BaseMessage 对象，而不是纯字符串。你要获取其中的文本内容，需要访问它的 .content 属性。
        const cleaned = rawContent.replace(/(\d+)\s*年/g, "$1");
        try {
            const json = JSON.parse(cleaned);
            console.log("手动修复后:", json);
        } catch (e) {
            console.error("手动解析仍然失败:", e);
        }
    }
}
console.log("包含原始数据的结构化输出：", rawResult);
