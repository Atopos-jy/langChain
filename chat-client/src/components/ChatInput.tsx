import { useState } from "react";

interface Props {
    onSend: (content: string) => void;
    disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
    const [value, setValue] = useState("");

    const handleSubmit = () => {
        const text = value.trim();
        if (!text || disabled) return;
        onSend(text);
        setValue("");
    };

    return (
        <div style={{ display: "flex", gap: 8, padding: 16, borderTop: "1px solid #ddd" }}>
            <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="输入消息..."
                disabled={disabled}
                style={{ flex: 1, padding: "10px 16px", borderRadius: 24, border: "1px solid #ccc", fontSize: 16 }}
            />
            <button
                onClick={handleSubmit}
                disabled={disabled || !value.trim()}
                style={{
                    padding: "10px 20px",
                    borderRadius: 24,
                    border: "none",
                    backgroundColor: disabled ? "#ccc" : "#007aff",
                    color: "#fff",
                    fontSize: 16,
                    cursor: disabled ? "not-allowed" : "pointer",
                }}
            >
                发送
            </button>
        </div>
    );
}
