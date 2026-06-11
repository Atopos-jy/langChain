import { ChatOpenAI } from "@langchain/openai";
import { CONFIG } from "./config";

/** LLM 实例：纯流式/非流式调用，不绑定工具 */
export const llm = new ChatOpenAI({
    model: CONFIG.llm.model,
    apiKey: CONFIG.llm.apiKey,
    temperature: CONFIG.llm.temperature,
    streamUsage: false,
    timeout: CONFIG.llm.timeout,
    maxRetries: CONFIG.llm.maxRetries,
    configuration: {
        baseURL: CONFIG.llm.baseURL,
    },
});
