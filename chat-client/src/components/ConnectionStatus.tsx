interface Props {
    isConnected: boolean;
}

export function ConnectionStatus({ isConnected }: Props) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
            <span style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: isConnected ? "#34c759" : "#ff3b30",
                display: "inline-block",
            }} />
            <span style={{ color: isConnected ? "#34c759" : "#ff3b30" }}>
                {isConnected ? "已连接" : "未连接"}
            </span>
        </div>
    );
}
