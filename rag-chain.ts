import dotenv from 'dotenv';
dotenv.config();

import { Embeddings } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

// ============================================================
// 案例二：RAG Chain — 检索增强生成
//
// 在案例一（向量索引 + 检索）的基础上，加上 LLM 生成步骤：
//
//   PDF 加载 → 文本分割 → 向量化 → 检索相关文档 → LLM 参考文档来回答
//                                                   ↑
//                                             这才是 RAG 的 G（Generation）
// ============================================================

// ============================================================
// 本地 TF-IDF Embedding（纯 JS，零依赖）
// ============================================================
class TfIdfEmbeddings extends Embeddings {
  private vocab = new Map<string, number>();
  private docCount = 0;
  private df = new Map<number, number>();

  constructor() { super({}); }

  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    const re = /[一-鿿]|[a-zA-Z0-9]+/g;
    for (const match of text.toLowerCase().matchAll(re)) {
      tokens.push(match[0]);
    }
    return tokens;
  }

  private textToVec(text: string): number[] {
    const tokens = this.tokenize(text);
    for (const t of tokens) {
      if (!this.vocab.has(t)) {
        this.vocab.set(t, this.vocab.size);
        this.df.set(this.vocab.size - 1, 0);
      }
    }
    const tf = new Array(this.vocab.size).fill(0);
    for (const t of tokens) tf[this.vocab.get(t)!]++;
    const n = this.docCount || 1;
    for (let i = 0; i < tf.length; i++) {
      if (tf[i] > 0) {
        tf[i] = (1 + Math.log(tf[i])) * (Math.log(n / (this.df.get(i) || 1)) + 1);
      }
    }
    const norm = Math.sqrt(tf.reduce((s, v) => s + v * v, 0)) || 1;
    return tf.map(v => v / norm);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.textToVec(text);
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    this.docCount += documents.length;
    for (const doc of documents) {
      const seen = new Set<number>();
      const tokens = this.tokenize(doc);
      for (const t of tokens) {
        const idx = this.vocab.get(t);
        if (idx !== undefined && !seen.has(idx)) {
          seen.add(idx);
          this.df.set(idx, (this.df.get(idx) || 0) + 1);
        }
      }
    }
    return documents.map(doc => this.textToVec(doc));
  }
}

// ============================================================
// LLM — 火山引擎 GLM-4.7
// ============================================================
const llm = new ChatOpenAI({
  model: "GLM-4.7",
  apiKey: process.env.ARK_API_KEY,
  temperature: 0.3,
  configuration: {
    baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3",
  },
});

// ============================================================
// 1. 加载文档
// ============================================================
console.log("📄 正在加载 PDF 文档...");
const pdfLoader = new PDFLoader("./library/reference.pdf");
const docs = await pdfLoader.load();
console.log(`✓ 加载完成: ${docs.length} 页`);

// ============================================================
// 2. 文本分割
// ============================================================
console.log("\n📝 文本分割...");
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 300,
  chunkOverlap: 150,
  separators: ["\n\n", "\n", "。", "！", "？", "，", "、", "；", " "],
});
const splitDocs = await textSplitter.splitDocuments(docs);
console.log(`✓ 分割完成: ${splitDocs.length} 个文本块`);

// ============================================================
// 3. 向量化存储
// ============================================================
console.log("\n🔍 创建向量存储...");
const embeddings = new TfIdfEmbeddings();
const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embeddings);
console.log("✓ 向量存储创建成功！");

const retriever = vectorStore.asRetriever({ k: 3 });

// ============================================================
// 4. RAG：检索 + 生成
// ============================================================
const questions = [
  "李元静的专业是什么？",
  "李元静会哪些前端技术？",
  "李元静有什么项目经验？",
  "李元静的实习经历？",
];

for (const question of questions) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`❓ 用户: ${question}`);

  // Step A: 检索相关文档
  console.log("🔎 正在检索相关文档...");
  const relevantDocs = await retriever.invoke(question);

  // 拼装上下文
  const context = relevantDocs.map(d => d.pageContent).join("\n\n");
  console.log(`📚 检索到 ${relevantDocs.length} 段相关文本`);

  // Step B: LLM 参考文档生成回答
  const prompt = `你是一个简历分析助手。请根据以下参考文档回答用户的问题。
如果文档中没有相关信息，请如实说"文档中没有找到相关信息"。

参考文档：
${context}

问题：${question}

回答：`;

  console.log("💬 LLM 正在生成回答...");
  const response = await llm.invoke([new HumanMessage(prompt)]);
  const answer = typeof response.content === "string" ? response.content : String(response.content);

  console.log(`\n🤖 回答: ${answer}`);
}

console.log(`\n${"═".repeat(60)}`);
console.log("🎉 RAG 完整链路演示完成！");
