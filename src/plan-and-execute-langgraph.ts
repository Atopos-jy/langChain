import dotenv from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";

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

const parser = new StringOutputParser();

// ============================================================
// Plan & Execute — LangGraph 实现
//
// 与手写版（plan-and-execute.ts）的对比：
//
//   手写版：
//     - while 循环 + if/else 控制流程
//     - 手动管理状态（steps、completed、iteration）
//     - 流程不直观，难以可视化
//
//   LangGraph 版：
//     - 声明式定义节点和边，自动管理状态流转
//     - StateGraph 描述执行图，节点间通过 State 传递数据
//     - 条件边实现分支逻辑，天然支持循环
//     - 流程图式的代码结构，一目了然
//
// 图结构：
//   [START] → planner → executor → replanner
//                                  ↗          ↘
//                           (继续执行)      (完成) → [END]
// ============================================================

// ---------- 状态定义 ----------
// Annotation.Root 定义图的共享状态
// 每个节点都能读写这些字段
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

// ---------- 工具定义 ----------
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
        "北京美食": "北京著名美食：烤鸭（全聚德、大董）、炸酱面、豆汁焦圈、涮羊肉",
        "烤鸭历史": "北京烤鸭起源于南北朝，明朝成为宫廷美食，清朝传入民间",
        "北京天气": "北京今天晴，25°C，适合出行",
        "全聚德": "全聚德创立于1864年，是北京最著名的烤鸭店，招牌菜为挂炉烤鸭",
        "大董": "大董烤鸭店以酥不腻烤鸭闻名，创新改良了传统烤鸭工艺",
      };
      const matched = Object.entries(results).find(([key]) => {
        const chars = key.split("");
        return chars.every((c) => query.includes(c));
      });
      return matched ? matched[1] : `未找到关于"${query}"的信息`;
    },
  },
];

// ---------- Planner 节点 ----------
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
  state: typeof PlanExecuteState.State
): Promise<typeof PlanExecuteState.Update> {
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

  console.log("📝 制定计划：");
  steps.forEach((s: string, i: number) => console.log(`  ${i + 1}. ${s}`));

  return { plan: steps, currentStepIndex: 0 };
}

// ---------- Executor 节点 ----------
const executorPrompt = PromptTemplate.fromTemplate(`
你是一个任务执行专家。请执行以下步骤，并返回执行结果。

步骤：{step}

请直接返回执行结果，简洁明了。
`);

async function executeNode(
  state: typeof PlanExecuteState.State
): Promise<typeof PlanExecuteState.Update> {
  const currentStep = state.plan[state.currentStepIndex];

  console.log(`\n🔄 执行步骤 [${state.currentStepIndex + 1}/${state.plan.length}]：${currentStep}`);

  const chain = executorPrompt.pipe(llm).pipe(parser);
  const result = await chain.invoke({ step: currentStep });

  console.log(`  ✅ 结果：${result}`);

  return {
    completed: [result],
    currentStepIndex: state.currentStepIndex + 1,
  };
}

// ---------- Replanner 节点 ----------
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
  state: typeof PlanExecuteState.State
): Promise<typeof PlanExecuteState.Update> {
  const remaining = state.plan.slice(state.currentStepIndex);

  if (remaining.length === 0) {
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
      results: state.completed.map((r, i) => `步骤${i + 1}：${r}`).join("\n"),
    });
    console.log("\n🎉 任务完成！");
    console.log(`最终结果：${summary}`);
    return { result: summary };
  }

  const chain = replannerPrompt.pipe(llm).pipe(parser);
  const response = await chain.invoke({
    task: state.task,
    completed: state.completed
      .map((r, i) => `步骤${i + 1}：${r}`)
      .join("\n"),
    remaining: remaining.map((s, i) => `${i + 1}. ${s}`).join("\n"),
  });

  let decision: { status: string; result?: string };
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    decision = jsonMatch ? JSON.parse(jsonMatch[0]) : { status: "continue" };
  } catch {
    decision = { status: "continue" };
  }

  if (decision.status === "complete") {
    console.log("\n🎉 任务完成！");
    console.log(`最终结果：${decision.result}`);
    return { result: decision.result || "任务已完成" };
  }

  console.log("\n📋 继续执行剩余计划...");
  return {};
}

// ---------- 条件路由 ----------
function shouldContinue(
  state: typeof PlanExecuteState.State
): "executor" | "replanner" | typeof END {
  if (state.result) {
    return END;
  }
  if (state.currentStepIndex < state.plan.length) {
    return "executor";
  }
  return "replanner";
}

function afterReplan(
  state: typeof PlanExecuteState.State
): "executor" | typeof END {
  if (state.result) {
    return END;
  }
  return "executor";
}

// ---------- 构建图 ----------
const graph = new StateGraph(PlanExecuteState)
  .addNode("planner", planNode)
  .addNode("executor", executeNode)
  .addNode("replanner", replanNode)
  .addEdge(START, "planner")
  .addConditionalEdges("planner", shouldContinue)
  .addConditionalEdges("executor", () => "replanner")
  .addConditionalEdges("replanner", afterReplan)
  .compile();

// ---------- 执行 ----------
const task = "我想了解北京的美食文化，包括历史背景和推荐餐厅";
console.log(`📋 任务：${task}\n`);

const result = await graph.invoke({ task });

console.log("\n========== 执行摘要 ==========");
console.log(`总步骤数：${result.completed.length}`);
result.completed.forEach((r: string, i: number) => {
  console.log(`  步骤${i + 1}：${r}`);
});
console.log(`最终结果：${result.result}`);