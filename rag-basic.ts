import dotenv from "dotenv";
dotenv.config();

import { Embeddings } from "@langchain/core/embeddings";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// ============================================================
// 本地 TF-IDF Embedding（纯 JS，零依赖）
// 基于词频 + 逆文档频率，无需外部 API
// ============================================================
class TfIdfEmbeddings extends Embeddings {
    private vocab = new Map<string, number>();
    private docCount = 0;
    private df = new Map<number, number>();

    constructor() {
        super({});
    }

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
        // 注册新词
        for (const t of tokens) {
            if (!this.vocab.has(t)) {
                this.vocab.set(t, this.vocab.size);
                this.df.set(this.vocab.size - 1, 0);
            }
        }
        // 统计 TF
        const tf = new Array(this.vocab.size).fill(0);
        for (const t of tokens) {
            tf[this.vocab.get(t)!]++;
        }
        // TF-IDF 加权 + L2 归一化
        const n = this.docCount || 1;
        for (let i = 0; i < tf.length; i++) {
            if (tf[i] > 0) {
                tf[i] =
                    (1 + Math.log(tf[i])) *
                    (Math.log(n / (this.df.get(i) || 1)) + 1);
            }
        }
        const norm = Math.sqrt(tf.reduce((s, v) => s + v * v, 0)) || 1;
        return tf.map((v) => v / norm);
    }

    async embedQuery(text: string): Promise<number[]> {
        return this.textToVec(text);
    }

    async embedDocuments(documents: string[]): Promise<number[][]> {
        this.docCount += documents.length;
        // 更新 DF（文档频率）
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
        return documents.map((doc) => this.textToVec(doc));
    }
}

const embeddings = new TfIdfEmbeddings();

console.log("📄 正在加载 PDF 文档...");
const pdfLoader = new PDFLoader("./library/reference.pdf");
const docs = await pdfLoader.load();
console.log(`✓ 加载完成: ${docs.length} 页\n`);

docs.forEach((doc, i) => {
    console.log(`页 ${i + 1} 字符数: ${doc.pageContent.length}`);
    console.log(`预览: ${doc.pageContent.substring(0, 200)}...\n`);
});

console.log("📝 开始文本分割（优化配置）...\n");

const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 300,
    chunkOverlap: 150,
    separators: ["\n\n", "\n", "。", "！", "？", "，", "、", "；", " "],
    lengthFunction: (text) => text.length,
});

const splitDocs = await textSplitter.splitDocuments(docs);
console.log(`✓ 分割完成: ${splitDocs.length} 个文本块\n`);

splitDocs.forEach((doc, i) => {
    console.log(
        `块 ${i + 1} [${doc.metadata.loc?.pageNumber || "N/A"}页, ${doc.pageContent.length}字符]:`,
    );
    console.log(`  ${doc.pageContent.substring(0, 100)}...\n`);
});

console.log("🔍 创建向量存储（分批处理）...\n");

let vectorStore: MemoryVectorStore | null = null;

const batchSize = 10;
for (let i = 0; i < splitDocs.length; i += batchSize) {
    const batch = splitDocs.slice(i, i + batchSize);
    console.log(
        `  处理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(splitDocs.length / batchSize)}...`,
    );

    if (!vectorStore) {
        vectorStore = await MemoryVectorStore.fromDocuments(batch, embeddings);
    } else {
        await vectorStore.addDocuments(batch);
    }
}
console.log("✓ 向量存储创建成功！\n");

console.log("🔬 测试检索效果（使用 Retriever）...\n");

const retriever = vectorStore!.asRetriever({
    k: 4,
    searchType: "similarity",
});

const queries = [
    "前端开发技能",
    "项目经验",
    "教育背景",
    "用户入学时间",
    "学校和专业",
    "AI Agent能力",
    "实习经历",
    "技术栈",
];

for (const query of queries) {
    console.log(`查询: "${query}"`);
    const results = await retriever.invoke(query);
    results.forEach((doc, i) => {
        console.log(
            `  结果${i + 1} [${doc.metadata?.loc?.pageNumber || "N/A"}页, ${doc.pageContent.length}字符]:`,
        );
        console.log(`    ${doc.pageContent.substring(0, 150)}...\n`);
    });
}

console.log("🎉 完成！");
