import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { Embeddings } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnablePassthrough, RunnableSequence } from "@langchain/core/runnables";
import type { Document } from "@langchain/core/documents";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const embeddings = new TfIdfEmbeddings();

// ============================================================
// 1. 多格式文档加载
// ============================================================
const TEXT_EXTENSIONS = new Set([
  ".md", ".markdown", ".txt", ".csv", ".json",
  ".xml", ".html", ".htm", ".log", ".yaml", ".yml",
  ".py", ".js", ".ts", ".java", ".c", ".cpp", ".h",
]);

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectFiles(fullPath));
    else if (entry.isFile()) results.push(fullPath);
  }
  return results;
}

async function loadDocuments(docsDir: string): Promise<Document[]> {
  const allDocs: Document[] = [];
  const files = collectFiles(docsDir);

  for (const filePath of files) {
    const file = path.relative(docsDir, filePath);
    const ext = path.extname(file).toLowerCase();

    try {
      if (ext === ".pdf") {
        console.log(`  📄 加载 PDF: ${file}`);
        allDocs.push(...await new PDFLoader(filePath).load());
      } else if (ext === ".md" || ext === ".markdown" || ext === ".txt" || TEXT_EXTENSIONS.has(ext)) {
        console.log(`  📃 加载文本: ${file}`);
        allDocs.push(...await new TextLoader(filePath).load());
      } else {
        console.log(`  ⏭️  跳过: ${file}（不支持的格式）`);
      }
    } catch (err) {
      console.error(`  ⚠️ 加载 ${file} 失败:`, err);
    }
  }
  return allDocs;
}

// ============================================================
// 2. 文本分割 + 向量存储
// ============================================================
const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 300,
  chunkOverlap: 150,
  separators: ["\n\n", "\n", "。", "！", "？", "，", "、", "；", " "],
});

async function buildVectorStore(docs: Document[]): Promise<MemoryVectorStore> {
  const splitDocs = await textSplitter.splitDocuments(docs);
  console.log(`  ✓ 分割完成: ${splitDocs.length} 个文本块`);
  console.log("  🔍 正在构建向量索引...");
  const store = new MemoryVectorStore(embeddings);
  for (let i = 0; i < splitDocs.length; i += 10) {
    const batch = splitDocs.slice(i, i + 10);
    await store.addDocuments(batch);
  }
  console.log("  ✓ 向量索引创建成功！");
  return store;
}

// ============================================================
// 3. 加载文档 + 构建索引
// ============================================================
const docsDir = path.join(__dirname, "library");
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
  console.log("📁 已创建 library/ 目录，请放入文档后重启");
  process.exit(0);
}

console.log("📄 从 library/ 加载文档...");
const docs = await loadDocuments(docsDir);
console.log(`  ✓ 共加载 ${docs.length} 个文档`);
const vectorStore = await buildVectorStore(docs);
const retriever = vectorStore.asRetriever({ k: 4 });

// ============================================================
// 4. LLM — 火山引擎 GLM-4.7
// ============================================================
const llm = new ChatOpenAI({
  model: "GLM-4.7",
  apiKey: process.env.ARK_API_KEY,
  temperature: 0.3,
  configuration: { baseURL: "https://ark.cn-beijing.volces.com/api/coding/v3" },
});

const parser = new StringOutputParser();

// ============================================================
// 5. Prompt + RAG Chain
// ============================================================
const ragPrompt = PromptTemplate.fromTemplate(
`你是一个知识库问答助手。请根据提供的上下文回答用户问题。

上下文：
{context}

用户问题：{question}

要求：
- 仅根据上述上下文回答，不要编造信息
- 如果上下文中没有相关信息，请回答"抱歉，知识库中没有相关内容"
- 回答要简洁、准确、有条理`
);

const ragChain = RunnablePassthrough.assign({
  context: (input: { question: string }) =>
    retriever.invoke(input.question).then(docs =>
      docs.map(d => d.pageContent).join("\n---\n")
    ),
}).pipe(ragPrompt).pipe(llm).pipe(parser);

// ============================================================
// 6. Express 服务
// ============================================================
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/chat", async (req, res) => {
  const { question } = req.body;
  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "请提供有效的问题" });
    return;
  }
  try {
    console.log(`🔍 查询: "${question}"`);
    const answer = await ragChain.invoke({ question });
    res.json({ answer });
  } catch (err: unknown) {
    console.error("查询出错:", err);
    res.status(500).json({ error: "查询失败" });
  }
});

// 流式 RAG
app.post("/api/chat/stream", async (req, res) => {
  const { question } = req.body;
  if (!question) { res.status(400).json({ error: "请提供问题" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = await ragChain.stream({ question });
    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: "查询失败" })}\n\n`);
    res.end();
  }
});

// 检索调试接口
app.post("/api/retrieve", async (req, res) => {
  const { question } = req.body;
  if (!question) { res.status(400).json({ error: "请提供问题" }); return; }
  const docs = await retriever.invoke(question);
  res.json({ question, results: docs.map((d, i) => ({
    index: i + 1, content: d.pageContent, metadata: d.metadata,
  })) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 RAG 服务已启动: http://localhost:${PORT}`);
  console.log(`   📌 POST /api/chat           — 单轮 RAG 问答`);
  console.log(`   📌 POST /api/chat/stream    — 流式 RAG`);
  console.log(`   📌 POST /api/retrieve       — 检索调试`);
});
