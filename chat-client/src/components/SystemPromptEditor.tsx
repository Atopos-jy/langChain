import { useState } from "react";

interface Props {
    onSystemChange: (content: string) => void;
}

export function SystemPromptEditor({ onSystemChange }: Props) {
    const [open, setOpen] = useState(false);
    const [value, setValue] = useState("你是一个智能助手, 认真回答用户的问题");

    const handleSave = () => {
        const text = value.trim();
        if (!text) return;
        onSystemChange(text);
        setOpen(false);
    };

    return (
        <div>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    background: "none",
                    border: "none",
                    color: "#007aff",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: 0,
                }}
            >
                {open ? "收起" : "设置系统提示词"}
            </button>

            {open && (
                <div style={{ marginTop: 8 }}>
                    <textarea
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        rows={3}
                        style={{
                            width: "100%",
                            padding: 8,
                            borderRadius: 8,
                            border: "1px solid #ccc",
                            fontSize: 13,
                            resize: "vertical",
                        }}
                    />
                    <button
                        onClick={handleSave}
                        style={{
                            marginTop: 4,
                            padding: "4px 12px",
                            borderRadius: 12,
                            border: "none",
                            backgroundColor: "#007aff",
                            color: "#fff",
                            fontSize: 13,
                            cursor: "pointer",
                        }}
                    >
                        保存
                    </button>
                </div>
            )}
        </div>
    );
}
