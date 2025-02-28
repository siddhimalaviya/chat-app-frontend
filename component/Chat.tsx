import { useState, useEffect, useRef } from "react";
import { FiSend, FiPaperclip, FiPhone, FiVideo, FiX } from "react-icons/fi";

interface Message {
    text: string;
    sender: string;
    type?: 'text' | 'file';
    fileName?: string;
    fileUrl?: string;
    fileType?: string;
}

interface WebRTCState {
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    peerConnection: RTCPeerConnection | null;
    isInCall: boolean;
    isVideo: boolean;
    incomingCall: boolean;
    caller: string | null;
}

export default function ChatApp() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState<string>("");
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [userId, setUserId] = useState<string>("");
    const [error, setError] = useState<string>("");
    const [callState, setCallState] = useState<WebRTCState>({
        localStream: null,
        remoteStream: null,
        peerConnection: null,
        isInCall: false,
        isVideo: false,
        incomingCall: false,
        caller: null
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        const socket = new WebSocket("ws://talented-empathy-production-e9b1.up.railway.app");

        socket.onopen = () => {
            console.log("Connected to WebSocket");
        };

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            console.log("Received message:", data);

            switch (data.type) {
                case "userId":
                    setUserId(data.userId);
                    break;

                case "chat":
                    if (data.sender !== userId) {
                        setMessages((prevMessages) => [...prevMessages, {
                            text: data.message,
                            sender: "other",
                            type: "text"
                        }]);
                    }
                    break;

                case "file":
                    if (data.sender !== userId) {
                        setMessages((prevMessages) => [...prevMessages, {
                            text: `Received file: ${data.fileName}`,
                            sender: "other",
                            type: "file",
                            fileName: data.fileName,
                            fileUrl: data.data,
                            fileType: data.fileType
                        }]);
                    }
                    break;

                case "call-offer":
                    handleIncomingCall(data);
                    break;

                case "call-answer":
                    handleCallAnswer(data);
                    break;

                case "ice-candidate":
                    handleNewICECandidate(data);
                    break;
            }
        };

        socket.onerror = (error) => {
            console.error("WebSocket error:", error);
        };

        socket.onclose = () => {
            console.log("Disconnected from WebSocket");
        };

        setWs(socket);

        return () => {
            socket.close();
            stopCall();
        };
    }, []);

    const sendMessage = async () => {
        if (input.trim() !== "" && ws && ws.readyState === WebSocket.OPEN) {
            try {
                const messageData = {
                    type: "chat",
                    message: input
                };
                ws.send(JSON.stringify(messageData));
                setMessages((prevMessages) => [...prevMessages, { text: input, sender: "me" }]);
                setInput("");
            } catch (error) {
                console.error("Error sending message:", error);
            }
        }
    };

    const startCall = async (isVideo: boolean) => {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("Your browser doesn't support media devices. Please use a modern browser.");
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: isVideo ? {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } : false,
                audio: true
            }).catch((err) => {
                if (err.name === "NotAllowedError") {
                    throw new Error("Please allow camera and microphone access to use this feature.");
                } else if (err.name === "NotFoundError") {
                    throw new Error("No camera or microphone found. Please check your devices.");
                } else {
                    throw err;
                }
            });

            const peerConnection = new RTCPeerConnection({
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
            });

            stream.getTracks().forEach(track => {
                peerConnection.addTrack(track, stream);
            });

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            peerConnection.ontrack = (event) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate && ws) {
                    ws.send(JSON.stringify({
                        type: "ice-candidate",
                        candidate: event.candidate,
                        target: "other" // In a real app, you'd specify the target user
                    }));
                }
            };

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            if (ws) {
                ws.send(JSON.stringify({
                    type: "call-offer",
                    offer: offer,
                    target: "other", // In a real app, you'd specify the target user
                    isVideo
                }));
            }

            setCallState({
                localStream: stream,
                remoteStream: null,
                peerConnection,
                isInCall: true,
                isVideo,
                incomingCall: false,
                caller: null
            });

        } catch (error) {
            console.error("Error starting call:", error);
        }
    };

    const handleIncomingCall = async (data: any) => {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error("Your browser doesn't support media devices. Please use a modern browser.");
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: data.isVideo ? {
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } : false,
                audio: true
            }).catch((err) => {
                if (err.name === "NotAllowedError") {
                    throw new Error("Please allow camera and microphone access to use this feature.");
                } else if (err.name === "NotFoundError") {
                    throw new Error("No camera or microphone found. Please check your devices.");
                } else {
                    throw err;
                }
            });

            const peerConnection = new RTCPeerConnection({
                iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
            });

            stream.getTracks().forEach(track => {
                peerConnection.addTrack(track, stream);
            });

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            peerConnection.ontrack = (event) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate && ws) {
                    ws.send(JSON.stringify({
                        type: "ice-candidate",
                        candidate: event.candidate,
                        target: data.caller
                    }));
                }
            };

            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            if (ws) {
                ws.send(JSON.stringify({
                    type: "call-answer",
                    answer: answer,
                    target: data.caller
                }));
            }

            setCallState({
                localStream: stream,
                remoteStream: null,
                peerConnection,
                isInCall: true,
                isVideo: data.isVideo,
                incomingCall: false,
                caller: null
            });

        } catch (error) {
            console.error("Error handling incoming call:", error);
        }
    };

    const handleCallAnswer = async (data: any) => {
        try {
            if (callState.peerConnection) {
                await callState.peerConnection.setRemoteDescription(
                    new RTCSessionDescription(data.answer)
                );
            }
        } catch (error) {
            console.error("Error handling call answer:", error);
        }
    };

    const handleNewICECandidate = async (data: any) => {
        try {
            if (callState.peerConnection) {
                await callState.peerConnection.addIceCandidate(
                    new RTCIceCandidate(data.candidate)
                );
            }
        } catch (error) {
            console.error("Error handling ICE candidate:", error);
        }
    };

    const stopCall = () => {
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(track => track.stop());
        }
        if (callState.peerConnection) {
            callState.peerConnection.close();
        }
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
        }
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
        }
        setCallState({
            localStream: null,
            remoteStream: null,
            peerConnection: null,
            isInCall: false,
            isVideo: false,
            incomingCall: false,
            caller: null
        });
    };

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !ws) return;

        try {
            // Check file size (max 64MB)
            if (file.size > 64 * 1024 * 1024) {
                setError("File size must be less than 64MB");
                return;
            }

            // Read file as base64
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target?.result as string;

                // Send file message
                const fileMessage = {
                    type: "file",
                    fileName: file.name,
                    fileType: file.type,
                    data: base64
                };

                ws.send(JSON.stringify(fileMessage));

                // Add file message to local state
                setMessages(prevMessages => [...prevMessages, {
                    text: `Sent file: ${file.name}`,
                    sender: "me",
                    type: "file",
                    fileName: file.name,
                    fileUrl: base64,
                    fileType: file.type
                }]);
            };

            reader.readAsDataURL(file);
        } catch (error) {
            console.error("Error sending file:", error);
            setError("Failed to send file");
        }

        // Clear the file input
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const downloadFile = (fileUrl: string, fileName: string) => {
        const link = document.createElement('a');
        link.href = fileUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="flex flex-col h-screen bg-gray-100">
            {/* Header */}
            <div className="p-4 bg-blue-600 text-white text-lg font-bold">Chat</div>

            {/* Call Interface */}
            {callState.isInCall && (
                <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center">
                    <div className="relative w-full max-w-4xl p-4">
                        <button
                            onClick={stopCall}
                            className="absolute top-4 right-4 p-2 bg-red-500 text-white rounded-full"
                        >
                            <FiX size={24} />
                        </button>
                        <div className="grid grid-cols-2 gap-4">
                            {callState.isVideo && (
                                <>
                                    <video
                                        ref={localVideoRef}
                                        autoPlay
                                        playsInline
                                        muted
                                        className="w-full bg-black rounded-lg"
                                    />
                                    <video
                                        ref={remoteVideoRef}
                                        autoPlay
                                        playsInline
                                        className="w-full bg-black rounded-lg"
                                    />
                                </>
                            )}
                            {!callState.isVideo && (
                                <div className="col-span-2 flex items-center justify-center h-48 bg-gray-800 rounded-lg">
                                    <div className="text-white text-xl">Audio Call in Progress</div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 p-4 overflow-y-auto space-y-2">
                {messages.map((msg, index) => (
                    <div
                        key={index}
                        className={`p-2 max-w-xs rounded-lg ${msg.sender === "me" ? "ml-auto bg-blue-500 text-white" : "bg-gray-200"
                            }`}
                    >
                        {msg.type === "file" ? (
                            <div className="flex flex-col">
                                <div className="flex items-center">
                                    <FiPaperclip className="mr-2" />
                                    <span className="truncate">{msg.fileName}</span>
                                </div>
                                <button
                                    onClick={() => msg.fileUrl && downloadFile(msg.fileUrl, msg.fileName || 'download')}
                                    className={`mt-2 px-2 py-1 rounded text-sm ${msg.sender === "me" ? "bg-white text-blue-500" : "bg-blue-500 text-white"
                                        }`}
                                >
                                    Download
                                </button>
                            </div>
                        ) : (
                            msg.text
                        )}
                    </div>
                ))}
            </div>

            {/* Input & Controls */}
            <div className="p-4 bg-white flex items-center gap-2 border-t">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    className="hidden"
                />
                <button
                    className="p-2 bg-gray-300 rounded-full hover:bg-gray-400"
                    onClick={() => fileInputRef.current?.click()}
                >
                    <FiPaperclip size={20} />
                </button>
                <input
                    type="text"
                    className="flex-1 p-2 border rounded-lg"
                    placeholder="Type a message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && sendMessage()}
                />
                <button className="p-2 bg-blue-500 text-white rounded-full" onClick={sendMessage}>
                    <FiSend size={20} />
                </button>
                <button
                    className="p-2 bg-green-500 text-white rounded-full"
                    onClick={() => !callState.isInCall && startCall(false)}
                >
                    <FiPhone size={20} />
                </button>
                <button
                    className="p-2 bg-red-500 text-white rounded-full"
                    onClick={() => !callState.isInCall && startCall(true)}
                >
                    <FiVideo size={20} />
                </button>
            </div>
        </div>
    );
}