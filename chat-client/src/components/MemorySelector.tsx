interface Props {
    currentStrategy: string;
    onSwitch: (strategy: string) => void;
}

const STRATEGIES = [
    { value: "buffer", label: "Buffer", desc: "完整对话历史" },
    { value: "window", label: "Window", desc: "滑动窗口（最近3轮）" },
    { value: "summary", label: "Summary", desc: "对话摘要压缩" },
    { value: "vector", label: "Vector", desc: "向量语义检索" },
];

export function MemorySelector({ currentStrategy, onSwitch }: Props) {
    return (
        <div style={{
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            alignItems: "center",
        }}>
            <span style={{ fontSize: 12, color: "#888", marginRight: 4 }}>🧠</span>
            {STRATEGIES.map((s) => (
                <button
                    key={s.value}
                    onClick={() => onSwitch(s.value)}
                    title={s.desc}
                    style={{
                        padding: "3px 10px",
                        borderRadius: 10,
                        border: "none",
                        fontSize: 11,
                        cursor: "pointer",
                        backgroundColor: currentStrategy === s.value ? "#34c759" : "#e9e9eb",
                        color: currentStrategy === s.value ? "#fff" : "#333",
                        fontWeight: currentStrategy === s.value ? 600 : 400,
                    }}
                >
                    {s.label}
                </button>
            ))}
        </div>
    );
}
