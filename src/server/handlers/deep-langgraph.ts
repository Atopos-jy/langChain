import { llm } from "../llm";
import { addAIMessage, addUserMessage, type Session } from "../session";
import { logger } from "../logger";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import WebSocket from "ws";

const parser = new StringOutputParser();

// ============================================================
// LangGraph Plan & Execute — 深度思考增强版
//
// 对比原有 deep.ts（RunnableSequence 固定三步）：
//   deep.ts:         问题 → 拆解 → 研究 → 综合（直线，固定）
//   deep-langgraph:  问题 → 规划 → 执行 → 评估 → 循环 → 完成（图，动态）
//
// 图结构：
//   [START] → planner → executor → replanner
//                                  ↗          ↘
//                           (继续执行)      (完成) → [END]
// ============================================================

// ---------- 工具定义 ----------
// 简单模拟工具，后续可以换成真实 API
interface Tool {
    name: string;
    description: string;
    execute: (input: string) => Promise<string>;
}

const tools: Tool[] = [
    {
        name: "search",
        description: "搜索网络信息",
        execute: async (query: string) => {
            const results: Record<string, string> = {
                北京美食:
                    "北京著名美食：烤鸭（全聚德、大董）、炸酱面、豆汁焦圈、涮羊肉",
                烤鸭历史:
                    "北京烤鸭起源于南北朝，明朝成为宫廷美食，清朝传入民间",
                北京天气: "北京今天晴，25°C，适合出行",
                JavaScript异步:
                    "JavaScript 异步编程主要靠 Promise、async/await 和回调函数",
                闭包: "闭包是函数和对其周围状态的引用的组合，是 JS 核心概念之一",
            };
            const matched = Object.entries(results).find(([key]) => {
                const chars = key.split("");
                return chars.every((c) => query.includes(c));
            });
            return matched ? matched[1] : `未找到关于"${query}"的信息`;
        },
    },
];

// ---------- 状态定义 ----------
const PlanExecuteState = Annotation.Root({
    task: Annotation<string>(),
    plan: Annotation<string[]>({
        reducer: (_prev, next) => next,
        default: () => [],
    }),
    completed: Annotation<string[]>({
        reducer: (prev, next) => [...prev, ...next],
        default: () => [],
    }),
    currentStepIndex: Annotation<number>({
        reducer: (_prev, next) => next,
        default: () => 0,
    }),
    result: Annotation<string>({
        reducer: (_prev, next) => next,
        default: () => "",
    }),
});

// ---------- 安全发送 ----------
function sendStatus(ws: WebSocket, content: string) {
    try {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "status", content }));
        }
    } catch (err: any) {
        logger.error(`❌ 发送状态消息失败: ${err.message}`);
    }
}

// ============================================================
// Planner 节点：制定计划
// ============================================================
const plannerPrompt = PromptTemplate.fromTemplate(`
你是一个任务规划专家。请将用户的请求分解为具体的执行步骤。

可用工具：
{tools}

请输出 JSON 格式的计划，格式如下：
{{"steps": ["步骤1的描述", "步骤2的描述", ...]}}

注意：
- 每个步骤应该是一个具体、可执行的动作
- 步骤之间要有逻辑顺序
- 步骤数量不超过 5 个

用户请求：{task}
`);

async function planNode(
    state: typeof PlanExecuteState.State,
    ws: WebSocket,
): Promise<typeof PlanExecuteState.Update> {
    sendStatus(ws, "🧠 正在分析任务并制定计划...");

    const chain = plannerPrompt.pipe(llm).pipe(parser);
    const result = await chain.invoke({
        tools: tools.map((t) => `${t.name}: ${t.description}`).join("\n"),
        task: state.task,
    });

    let steps: string[];
    try {
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        steps = jsonMatch ? JSON.parse(jsonMatch[0]).steps : [state.task];
    } catch {
        steps = [state.task];
    }

    const planText = steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
    sendStatus(ws, `📝 已制定计划：\n${planText}`);

    return { plan: steps, currentStepIndex: 0 };
}

// ============================================================
// Executor 节点：执行当前步骤
// ============================================================
const executorPrompt = PromptTemplate.fromTemplate(`
你是一个任务执行专家。请执行以下步骤，并返回执行结果。

步骤：{step}

请直接返回执行结果，简洁明了。
`);

async function executeNode(
    state: typeof PlanExecuteState.State,
    ws: WebSocket,
): Promise<typeof PlanExecuteState.Update> {
    const currentStep = state.plan[state.currentStepIndex];

    sendStatus(
        ws,
        `🔄 正在执行步骤 [${state.currentStepIndex + 1}/${state.plan.length}]：${currentStep}`,
    );

    // 与原版一致：直接让 LLM 执行当前步骤
    const chain = executorPrompt.pipe(llm).pipe(parser);
    const result = await chain.invoke({ step: currentStep });

    sendStatus(ws, `  ✅ 步骤完成`);

    return {
        completed: [result],
        currentStepIndex: state.currentStepIndex + 1,
    };
}

// ============================================================
// Replanner 节点：评估进度，决定继续还是完成
// ============================================================
const replannerPrompt = PromptTemplate.fromTemplate(`
你是一个任务重规划专家。请评估执行结果，并决定下一步。

原始任务：{task}
已完成的步骤和结果：
{completed}
剩余计划：
{remaining}

请判断：
1. 如果任务已经完成，返回：{{"status": "complete", "result": "最终结果"}}
2. 如果需要继续执行，返回：{{"status": "continue"}}

请直接输出 JSON。
`);

async function replanNode(
    state: typeof PlanExecuteState.State,
    ws: WebSocket,
): Promise<typeof PlanExecuteState.Update> {
    const remaining = state.plan.slice(state.currentStepIndex);

    // 所有步骤执行完毕 → 自动生成总结
    if (remaining.length === 0) {
        sendStatus(ws, "📋 所有步骤执行完毕，正在生成总结...");

        const summaryPrompt = PromptTemplate.fromTemplate(`
请根据以下执行结果，生成一个简洁的最终总结。

任务：{task}
执行结果：
{results}

请用 2-3 句话总结。
`);
        const chain = summaryPrompt.pipe(llm).pipe(parser);
        const summary = await chain.invoke({
            task: state.task,
            results: state.completed
                .map((r, i) => `步骤${i + 1}：${r}`)
                .join("\n"),
        });
        return { result: summary };
    }

    sendStatus(ws, "📋 正在评估执行进度...");

    const chain = replannerPrompt.pipe(llm).pipe(parser);
    const response = await chain.invoke({
        task: state.task,
        completed: state.completed
            .map((r, i) => `步骤${i + 1}：${r}`)
            .join("\n"),
        remaining: remaining.map((s, i) => `${i + 1}. ${s}`).join("\n"),
    });

    // ⚡ 你的任务 2：解析 replanner 返回的 JSON，提取决策
    // response 的格式应该是：
    //   {"status": "continue"}
    //   或 {"status": "complete", "result": "xxx"}
    // 如果解析失败，默认继续执行
    // 补充下面的解析逻辑：

    let decision: { status: string; result?: string };
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        decision = jsonMatch
            ? JSON.parse(jsonMatch[0])
            : { status: "continue", result: "xxx" };
    } catch {
        decision = { status: "continue" };
    }

    if (decision.status === "complete") {
        sendStatus(ws, "🎉 任务完成！");
        return { result: decision.result || "任务已完成" };
    }

    sendStatus(ws, "📋 继续执行剩余计划...");
    return {};
}

// ============================================================
// 条件路由
// ============================================================
function shouldContinue(
    state: typeof PlanExecuteState.State,
): "executor" | "replanner" | typeof END {
    if (state.result) return END;
    if (state.currentStepIndex < state.plan.length) return "executor";

    // ⚡ 你的任务 3：如果所有步骤都执行完了，应该走哪条路？
    // 提示：replanner 负责做最终评估
    // 补充返回值：
    return "replanner";
}

function afterReplan(
    state: typeof PlanExecuteState.State,
): "executor" | typeof END {
    if (state.result) return END;
    return "executor";
}

// ============================================================
// 构建图
// ============================================================
function createGraph(ws: WebSocket) {
    return new StateGraph(PlanExecuteState)
        .addNode("planner", (s: typeof PlanExecuteState.State) =>
            planNode(s, ws),
        )
        .addNode("executor", (s: typeof PlanExecuteState.State) =>
            executeNode(s, ws),
        )
        .addNode("replanner", (s: typeof PlanExecuteState.State) =>
            replanNode(s, ws),
        )
        .addEdge(START, "planner")
        .addConditionalEdges("planner", shouldContinue)
        .addConditionalEdges("executor", () => "replanner")
        .addConditionalEdges("replanner", afterReplan)
        .compile();
}

// ============================================================
// Handler 入口
// ============================================================
export async function handleDeepLangGraph(
    ws: WebSocket,
    session: Session,
    content: string,
    _templateKey?: string,
): Promise<void> {
    if (!content.trim()) {
        ws.send(JSON.stringify({ type: "error", content: "消息不能为空" }));
        return;
    }

    addUserMessage(session, content);

    try {
        const start = Date.now();

        sendStatus(ws, `🚀 启动 LangGraph 深度思考模式...`);

        const graph = createGraph(ws);
        const result = await graph.invoke({ task: content });

        const elapsed = Date.now() - start;

        addAIMessage(session, result.result);

        ws.send(
            JSON.stringify({
                type: "done",
                mode: "deep-langgraph",
                content: result.result,
                elapsed,
                summary: {
                    totalSteps: result.completed.length,
                    completed: result.completed,
                },
            }),
        );

        logger.info(
            `[${session.id}] 🧠 deep-langgraph 完成 (${elapsed}ms, ${result.completed.length} 步)`,
        );
    } catch (error: any) {
        logger.error(`[${session.id}] deep-langgraph 调用失败`, error.message);
        ws.send(
            JSON.stringify({
                type: "error",
                content: `请求失败: ${error.message}`,
            }),
        );
    }
}
