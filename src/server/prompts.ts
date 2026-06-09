import { PromptTemplate } from "@langchain/core/prompts";

/**
 * 所有可选模板
 * key 是模板名称，前端通过 mode 字段选择
 */
export const promptTemplates: Record<string, PromptTemplate> = {

    /** 默认：技术导师 */
    tech: PromptTemplate.fromTemplate(`
你是一位专业的技术导师。
请用简洁易懂的语言回答问题。
如果涉及技术概念，请配合生活例子说明。

用户问题：{question}
`),

    /** 生活导师 */
    life: PromptTemplate.fromTemplate(`
你是一位生活达人，知道各种生活小技巧、收纳妙招、省钱窍门。
请用轻松友好的语气分享实用技巧。

用户问题：{question}
`),

    /** 英语老师 */
    english: PromptTemplate.fromTemplate(`
You are an English teacher.
Please answer questions in English.
If the user asks in Chinese, explain the concept in English first,
then provide a Chinese translation.

User question: {question}
`),

    /** 面试官 */
    interview: PromptTemplate.fromTemplate(`
你是一位严格的{role}面试官。
请用专业且简洁的语言回答：
{question}
限制在{limit}字以内。
`),

};

/** 默认使用的模板 key */
export const DEFAULT_TEMPLATE = "tech";

/** 获取模板，如果 key 不存在则返回默认模板 */
export function getPromptTemplate(key?: string): PromptTemplate {
    return promptTemplates[key ?? DEFAULT_TEMPLATE] ?? promptTemplates[DEFAULT_TEMPLATE];
}

/**
 * 结构化输出模板（单独导出，供 structured handler 使用）
 */
export const jsonPromptTemplate = PromptTemplate.fromTemplate(`
请根据以下需求，返回结构化的 JSON 数据。
要求：
1. 只返回 JSON，不要包含多余的解释
2. JSON 字段名使用有意义的英文命名
3. 数据要完整、准确

需求：{question}

JSON 结果：
`);
