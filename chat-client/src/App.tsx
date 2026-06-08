import { useWebSocket } from "./hooks/useWebSocket";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { SystemPromptEditor } from "./components/SystemPromptEditor";

function App() {
    const { isConnected, messages, sendMessage, clearMessages, sendSystemPrompt } = useWebSocket();

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            height: "100vh",
            maxWidth: 720,
            margin: "0 auto",
        }}>
            {/* 顶部栏 */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid #ddd",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <strong style={{ fontSize: 18 }}>DeepSeek Chat</strong>
                    <ConnectionStatus isConnected={isConnected} />
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <SystemPromptEditor onSystemChange={sendSystemPrompt} />
                    <button
                        onClick={clearMessages}
                        style={{
                            background: "none",
                            border: "none",
                            color: "#ff3b30",
                            cursor: "pointer",
                            fontSize: 13,
                            padding: 0,
                        }}
                    >
                        清除对话
                    </button>
                </div>
            </div>

            {/* 消息列表 */}
            <MessageList messages={messages} />

            {/* 输入框 */}
            <ChatInput onSend={sendMessage} disabled={!isConnected} />
        </div>
    );
}

export default App;
