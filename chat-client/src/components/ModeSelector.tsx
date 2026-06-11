import type { InvokeMode } from "../hooks/useWebSocket";

interface Props {
    mode: InvokeMode;
    onChange: (mode: InvokeMode) => void;
}

const MODES: { value: InvokeMode; label: string; desc: string }[] = [
    { value: "stream", label: "Stream", desc: "流式输出" },
    { value: "invoke", label: "Invoke", desc: "一次性返回" },
    { value: "batch", label: "Batch", desc: "批量并发" },
    { value: "structured", label: "Structured", desc: "结构化输出" },
    { value: "deep", label: "Deep", desc: "深度思考（任务拆解）" },
    { value: "deep-langgraph", label: "Deep-Graph", desc: "深度思考（Plan & Execute 图结构）" },
    { value: "tool", label: "Tool", desc: "工具调用（天气查询）" },
];

export function ModeSelector({ mode, onChange }: Props) {
    return (
        <div style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
        }}>
            {MODES.map((m) => (
                <button
                    key={m.value}
                    onClick={() => onChange(m.value)}
                    title={m.desc}
                    style={{
                        padding: "4px 12px",
                        borderRadius: 12,
                        border: "none",
                        fontSize: 12,
                        cursor: "pointer",
                        backgroundColor: mode === m.value ? "#007aff" : "#e9e9eb",
                        color: mode === m.value ? "#fff" : "#333",
                        fontWeight: mode === m.value ? 600 : 400,
                    }}
                >
                    {m.label}
                </button>
            ))}
        </div>
    );
}
