import { useState, useEffect, useRef } from "react";
import {
    FiSend,
    FiPaperclip,
    FiPhone,
    FiVideo,
    FiX,
    FiMic,
    FiMicOff,
    FiCamera,
    FiCameraOff,
    FiFile,
    FiImage,
    FiMusic,
    FiFilm,
    FiFileText
} from "react-icons/fi";

// Interfaces
interface Message {
    id: string;
    text: string;
    sender: string;
    type?: 'text' | 'file';
    fileName?: string;
    fileUrl?: string;
    fileType?: string;
    timestamp: number;
}

interface CallState {
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    peerConnection: RTCPeerConnection | null;
    isInCall: boolean;
    isVideo: boolean;
    incomingCall: boolean;
    caller: string | null;
    callerName: string | null;
    callStatus: 'idle' | 'calling' | 'rejected' | 'connected';
    callStartTime: number | null;
    callDuration: string;
    isMuted: boolean;
    isCameraOff: boolean;
}

interface ConnectionState {
    status: 'connected' | 'disconnected' | 'connecting';
    lastConnected: number | null;
    reconnectAttempts: number;
}

const ChatRoom: React.FC = () => {
    // State Management
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState("");
    const [ws, setWs] = useState<WebSocket | null>(null);
    const [userId, setUserId] = useState<string>("");
    const [error, setError] = useState<string>("");
    const [callState, setCallState] = useState<CallState>({
        localStream: null,
        remoteStream: null,
        peerConnection: null,
        isInCall: false,
        isVideo: false,
        incomingCall: false,
        caller: null,
        callerName: null,
        callStatus: 'idle',
        callStartTime: null,
        callDuration: '00:00',
        isMuted: false,
        isCameraOff: false,
    });
    const [connectionState, setConnectionState] = useState<ConnectionState>({
        status: 'connecting',
        lastConnected: null,
        reconnectAttempts: 0
    });

    // Refs
    const fileInputRef = useRef<HTMLInputElement>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // WebSocket Connection Management
    useEffect(() => {
        debugger
        const socket = new WebSocket("wss://talented-empathy-production-e9b1.up.railway.app");

        socket.onopen = () => {
            console.log("Connected to WebSocket");
        };

        socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            console.log("Received message:", data);
            debugger
            switch (data.type) {
                case "userId":
                    setUserId(data.userId);
                    break;

                case "chat":
                    if (data.sender !== userId) {
                        setMessages((prevMessages) => [...prevMessages, {
                            id: Date.now().toString(),
                            text: data.message,
                            sender: "other",
                            type: "text",
                            timestamp: Date.now()
                        }]);
                    }
                    break;

                case "file":
                    if (data.sender !== userId) {
                        setMessages((prevMessages) => [...prevMessages, {
                            id: Date.now().toString(),
                            text: `Received file: ${data.fileName}`,
                            sender: "other",
                            type: "file",
                            fileName: data.fileName,
                            fileUrl: data.data,
                            fileType: data.fileType,
                            timestamp: Date.now()
                        }]);
                    }
                    break;

                case "call-offer":
                    setCallState(prev => ({
                        ...prev,
                        incomingCall: true,
                        caller: data.caller,
                        callerName: data.callerName || "Someone",
                        isVideo: data.isVideo
                    }));
                    sessionStorage.setItem('pendingOffer', JSON.stringify(data));
                    break;

                case "call-answer":
                    await handleCallAnswer(data);
                    const startTime = Date.now();
                    setCallState(prev => ({
                        ...prev,
                        callStatus: 'connected',
                        callStartTime: startTime,
                        callDuration: '00:00'
                    }));

                    // Start counting immediately
                    const now = Date.now();
                    const diff = now - startTime;
                    const minutes = Math.floor(diff / 60000);
                    const seconds = Math.floor((diff % 60000) / 1000);
                    const duration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

                    setCallState(prev => ({
                        ...prev,
                        callDuration: duration
                    }));
                    break;

                case "ice-candidate":
                    handleIceCandidate(data);
                    break;

                case "call-rejected":
                    setCallState(prev => ({
                        ...prev,
                        callStatus: 'rejected'
                    }));
                    // setTimeout(() => {
                    //     stopCall(true, true);
                    // }, 2000);
                    break;

                case "call-ended":
                    // Store call info before cleanup
                    const endedCallType = callState.isVideo ? 'Video' : 'Audio';
                    const endedCallDuration = callState.callDuration;
                    const wasConnected = callState.callStatus === 'connected';

                    // Stop all media tracks
                    if (callState.localStream) {
                        callState.localStream.getTracks().forEach(track => {
                            track.stop();
                            track.enabled = false;
                        });
                    }

                    // Close peer connection
                    if (callState.peerConnection) {
                        try {
                            callState.peerConnection.getSenders().forEach(sender => {
                                if (sender.track) {
                                    sender.track.stop();
                                    sender.track.enabled = false;
                                }
                            });
                            callState.peerConnection.close();
                        } catch (err) {
                            console.error('Error closing peer connection:', err);
                        }
                    }

                    // Clear video elements
                    if (localVideoRef.current) {
                        localVideoRef.current.srcObject = null;
                    }
                    if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = null;
                    }

                    // Reset call state completely
                    setCallState({
                        localStream: null,
                        remoteStream: null,
                        peerConnection: null,
                        isInCall: false,
                        isVideo: false,
                        incomingCall: false,
                        caller: null,
                        callerName: null,
                        callStatus: 'idle',
                        callStartTime: null,
                        callDuration: '00:00',
                        isMuted: false,
                        isCameraOff: false,
                    });

                    // Add call ended message
                    if (wasConnected) {
                        setMessages(prev => [...prev, {
                            id: Date.now().toString(),
                            text: `${endedCallType} call ended: ${endedCallDuration}`,
                            sender: 'system',
                            type: 'text',
                            timestamp: Date.now()
                        }]);
                    }
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
            // stopCall();
        };
    }, []);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        if (callState.callStatus === 'connected' && callState.callStartTime) {
            intervalId = setInterval(() => {
                const now = Date.now();
                const diff = now - callState.callStartTime!;
                const minutes = Math.floor(diff / 60000);
                const seconds = Math.floor((diff % 60000) / 1000);
                const duration = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

                setCallState(prev => ({
                    ...prev,
                    callDuration: duration
                }));
            }, 1000);
        }

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [callState.callStatus, callState.callStartTime]);

    const connectWebSocket = () => {
        try {
            const socket = new WebSocket("wss://talented-empathy-production-e9b1.up.railway.app");

            socket.onopen = () => {
                setConnectionState({
                    status: 'connected',
                    lastConnected: Date.now(),
                    reconnectAttempts: 0
                });
                console.log("Connected to WebSocket");
            };
            socket.onmessage = handleWebSocketMessage;

            socket.onclose = () => {
                console.log("WebSocket connection closed");
                setConnectionState(prev => ({
                    ...prev,
                    status: 'disconnected'
                }));
                handleReconnection();
            };

            socket.onerror = (error) => {
                console.error("WebSocket error:", error);
                setError("Connection error. Trying to reconnect...");
            };

            setWs(socket);
        } catch (error) {
            console.error("Failed to connect:", error);
            handleReconnection();
        }
    };

    const handleReconnection = () => {
        if (connectionState.reconnectAttempts < 5) {
            const timeout = Math.min(1000 * Math.pow(2, connectionState.reconnectAttempts), 30000);
            reconnectTimeoutRef.current = setTimeout(() => {
                setConnectionState(prev => ({
                    ...prev,
                    reconnectAttempts: prev.reconnectAttempts + 1,
                    status: 'connecting'
                }));
                connectWebSocket();
            }, timeout);
        } else {
            setError("Unable to connect. Please check your internet connection and refresh the page.");
        }
    };

    // Message Handling
    const handleWebSocketMessage = (event: MessageEvent) => {
        console.log("Received WebSocket message:", event.data);
        const data = JSON.parse(event.data);
        console.log("Parsed message data:", data);

        debugger
        switch (data.type) {
            case "userId":
                console.log("Setting userId:", data.userId);
                setUserId(data.userId);
                break;

            case "chat":
                if (data.sender !== userId) {
                    setMessages((prevMessages) => [...prevMessages, {
                        id: Date.now().toString(),
                        text: data.message,
                        sender: "other",
                        type: "text",
                        timestamp: Date.now()
                    }]);
                }
                break;
            case "message":
                console.log("Handling new message:", data);
                handleNewMessage(data);
                break;

            case "file":
                handleFileMessage(data);
                break;

            case "call-offer":
                handleCallOffer(data);
                break;

            case "call-answer":
                handleCallAnswer(data);
                break;

            case "call-ended":
                handleCallEnded(data);
                break;

            case "ice-candidate":
                handleIceCandidate(data);
                break;
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleNewMessage = (data: any) => {
        console.log("Creating new message with data:", data);
        console.log("Current userId:", userId);

        // Don't create duplicate messages for the sender
        if (data.sender === userId && data.timestamp === data.originalTimestamp) {
            return;
        }

        const newMessage: Message = {
            id: Date.now().toString(),
            text: data.text || data.message,
            sender: data.sender === userId ? "me" : "other",
            type: "text",
            timestamp: data.timestamp || Date.now()
        };

        console.log("New message object:", newMessage);
        setMessages(prev => [...prev, newMessage]);
        scrollToBottom();
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleFileMessage = (data: any) => {
        const newMessage: Message = {
            id: Date.now().toString(),
            text: `File: ${data.fileName}`,
            sender: data.sender === userId ? "me" : "other",
            type: "file",
            timestamp: Date.now(),
            fileName: data.fileName,
            fileUrl: data.fileUrl,
            fileType: data.fileType
        };
        setMessages(prev => [...prev, newMessage]);
        scrollToBottom();
    };

    const sendMessage = (): void => {
        if (input.trim() && ws && ws.readyState === WebSocket.OPEN) {
            const timestamp = Date.now();
            const messageData = {
                type: "chat",
                message: input.trim(),
                sender: userId,
                timestamp: timestamp
            };

            console.log("Sending message:", messageData);

            // Add message locally for sender
            const newMessage: Message = {
                id: timestamp.toString(),
                text: input.trim(),
                sender: "me",
                type: "text",
                timestamp: timestamp
            };
            ws.send(JSON.stringify(messageData));
            setMessages(prev => [...prev, newMessage]);
            setInput("");
        } else if (ws?.readyState !== WebSocket.OPEN) {
            setError("Connection lost. Please wait while we reconnect...");
        }
    };

    // File Handling
    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !ws) return;

        try {
            // Validate file size (max 64MB)
            const maxSize = 64 * 1024 * 1024;
            if (file.size > maxSize) {
                setError("File size must be less than 64MB");
                return;
            }

            // Read and send file
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64 = e.target?.result as string;

                const fileMessage = {
                    type: "file",
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: file.size,
                    data: base64,
                    sender: userId
                };

                ws.send(JSON.stringify(fileMessage));

                // Add file message locally for sender
                const newMessage: Message = {
                    id: Date.now().toString(),
                    text: `File: ${file.name}`,
                    sender: "me",
                    type: "file",
                    fileName: file.name,
                    fileUrl: base64,
                    fileType: file.type,
                    timestamp: Date.now()
                };
                setMessages(prev => [...prev, newMessage]);
            };

            reader.readAsDataURL(file);
        } catch (error) {
            console.error("Error sending file:", error);
            setError("Failed to send file");
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const getFileIcon = (fileType: string) => {
        if (fileType.startsWith('image/')) return <FiImage />;
        if (fileType.startsWith('audio/')) return <FiMusic />;
        if (fileType.startsWith('video/')) return <FiFilm />;
        if (fileType.startsWith('text/')) return <FiFileText />;
        return <FiFile />;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleIceCandidate = async (data: any) => {
        try {
            if (callState.peerConnection) {
                await callState.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
        } catch (error) {
            console.error("Error handling ICE candidate:", error);
        }
    };

    const startCall = async (isVideo: boolean) => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: isVideo ? { width: 1280, height: 720 } : false,
                audio: true
            });

            const peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                ],
                iceCandidatePoolSize: 10,
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require',
                iceTransportPolicy: 'all'
            });

            stream.getTracks().forEach(track => {
                peerConnection.addTrack(track, stream);
            });

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            setCallState(prev => ({
                ...prev,
                isInCall: true,
                isVideo,
                localStream: stream,
                peerConnection,
                callStatus: 'calling'
            }));

            // Handle incoming tracks
            peerConnection.ontrack = (event) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
                setCallState(prev => ({
                    ...prev,
                    remoteStream: event.streams[0]
                }));
            };

            // Create and send offer
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            ws?.send(JSON.stringify({
                type: 'call-offer',
                offer,
                isVideo
            }));

            // Add ICE candidate handling
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    ws?.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: event.candidate,
                        target: callState.caller
                    }));
                }
            };

            // Add connection state monitoring
            peerConnection.onconnectionstatechange = () => {
                console.log('Connection state:', peerConnection.connectionState);
                if (peerConnection.connectionState === 'failed') {
                    setError('Call connection failed. Please try again.');
                    endCall();
                }
            };

            // Add ICE connection state monitoring
            peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', peerConnection.iceConnectionState);
                if (peerConnection.iceConnectionState === 'disconnected') {
                    setError('Call connection lost. Attempting to reconnect...');
                }
            };

            // Add negotiation needed handler
            peerConnection.onnegotiationneeded = async () => {
                try {
                    await peerConnection.setLocalDescription(await peerConnection.createOffer());
                    if (peerConnection.localDescription) {
                        ws?.send(JSON.stringify({
                            type: 'call-offer',
                            offer: peerConnection.localDescription,
                            isVideo: callState.isVideo
                        }));
                    }
                } catch (err) {
                    console.error('Error during negotiation:', err);
                }
            };

        } catch (error) {
            console.error("Error starting call:", error);
            setError("Failed to start call. Please check your camera/microphone permissions.");
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCallAnswer = async (data: any) => {
        if (callState.peerConnection) {
            await callState.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            setCallState(prev => ({
                ...prev,
                callStatus: 'connected',
                callStartTime: Date.now()
            }));
        }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCallOffer = async (data: any) => {
        setCallState(prev => ({
            ...prev,
            incomingCall: true,
            caller: data.caller,
            callerName: data.callerName || "Someone",
            isVideo: data.isVideo
        }));
    };

    const acceptCall = async () => {
        try {
            const storedData = sessionStorage.getItem('pendingOffer');
            if (!storedData) {
                console.error('No pending offer found');
                return;
            }

            const data = JSON.parse(storedData);

            // Get user media based on call type
            const stream = await navigator.mediaDevices.getUserMedia({
                video: data.isVideo ? { width: 1280, height: 720 } : false,
                audio: true
            });

            // Create and configure peer connection
            const peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ],
                iceCandidatePoolSize: 10,
                bundlePolicy: 'max-bundle',
                rtcpMuxPolicy: 'require',
                iceTransportPolicy: 'all'
            });

            // Add local stream tracks to peer connection
            stream.getTracks().forEach(track => {
                peerConnection.addTrack(track, stream);
            });

            // Set local video
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }

            // Handle incoming tracks
            peerConnection.ontrack = (event) => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                }
                setCallState(prev => ({
                    ...prev,
                    remoteStream: event.streams[0]
                }));
            };

            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    ws?.send(JSON.stringify({
                        type: 'ice-candidate',
                        candidate: event.candidate,
                        target: data.caller
                    }));
                }
            };

            // Set remote description (offer)
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));

            // Create and set local description (answer)
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            // Send answer to caller
            ws?.send(JSON.stringify({
                type: 'call-answer',
                answer,
                target: data.caller
            }));

            // Update call state
            setCallState(prev => ({
                ...prev,
                isInCall: true,
                incomingCall: false,
                isVideo: data.isVideo,
                localStream: stream,
                peerConnection,
                callStatus: 'connected',
                callStartTime: Date.now()
            }));

            // Clear stored offer
            sessionStorage.removeItem('pendingOffer');

        } catch (error) {
            console.error('Error accepting call:', error);
            setError('Failed to accept call. Please check your camera/microphone permissions.');
            cleanup();
        }
    };

    const rejectCall = () => {
        ws?.send(JSON.stringify({
            type: 'call-rejected',
            target: callState.caller
        }));

        setCallState(prev => ({
            ...prev,
            incomingCall: false,
            caller: null,
            callerName: null
        }));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleCallEnded = (data: any) => {
        cleanup();
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: `Call ended: ${data.duration || callState.callDuration}`,
            sender: 'system',
            type: 'text',
            timestamp: Date.now()
        }]);
    };

    const endCall = () => {
        // Add call ended message for the caller immediately
        const duration = callState.callDuration;
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: `Call ended: ${duration}`,
            sender: 'system',
            type: 'text',
            timestamp: Date.now()
        }]);

        // Clean up streams and connection
        cleanup();

        // Send call ended with duration to the other participant
        ws?.send(JSON.stringify({
            type: 'call-ended',
            duration: duration
        }));
    };

    const toggleMute = () => {
        if (callState.localStream) {
            callState.localStream.getAudioTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setCallState(prev => ({
                ...prev,
                isMuted: !prev.isMuted
            }));
        }
    };

    const toggleCamera = () => {
        if (callState.localStream) {
            callState.localStream.getVideoTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setCallState(prev => ({
                ...prev,
                isCameraOff: !prev.isCameraOff
            }));
        }
    };

    // Utility Functions
    const cleanup = () => {
        callState.localStream?.getTracks().forEach(track => track.stop());
        callState.peerConnection?.close();

        setCallState({
            isInCall: false,
            isVideo: false,
            isMuted: false,
            isCameraOff: false,
            localStream: null,
            remoteStream: null,
            peerConnection: null,
            callStatus: 'idle',
            callStartTime: null,
            callDuration: '00:00',
            incomingCall: false,
            caller: null,
            callerName: null
        });
    };

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    // UI Components
    // const renderConnectionStatus = () => (
    //     <div className={`flex items-center gap-2 px-4 py-2 ${connectionState.status === 'connected'
    //         ? 'bg-green-500'
    //         : connectionState.status === 'connecting'
    //             ? 'bg-yellow-500'
    //             : 'bg-red-500'
    //         } text-white`}>
    //         {connectionState.status === 'connected' ? (
    //             <><FiWifi /> Connected</>
    //         ) : connectionState.status === 'connecting' ? (
    //             <><FiWifi className="animate-pulse" /> Connecting...</>
    //         ) : (
    //             <><FiWifiOff /> Disconnected</>
    //         )}
    //     </div>
    // );

    const renderCallInterface = () => (
        <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center">
            <div className="relative w-full max-w-4xl p-4">
                {/* Call Duration Display */}
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-gray-900 bg-opacity-75 px-4 py-2 rounded-full text-white">
                    {callState.callStatus === 'connected' ? callState.callDuration : 'Connecting...'}
                </div>

                {/* Call Controls */}
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4 bg-gray-900 bg-opacity-75 px-6 py-3 rounded-full">
                    <button
                        onClick={toggleMute}
                        className={`p-3 rounded-full ${callState.isMuted ? 'bg-red-500' : 'bg-gray-600'}`}
                    >
                        {callState.isMuted ? <FiMicOff /> : <FiMic />}
                    </button>

                    {callState.isVideo && (
                        <button
                            onClick={toggleCamera}
                            className={`p-3 rounded-full ${callState.isCameraOff ? 'bg-red-500' : 'bg-gray-600'}`}
                        >
                            {callState.isCameraOff ? <FiCameraOff /> : <FiCamera />}
                        </button>
                    )}

                    <button
                        onClick={endCall}
                        className="p-3 bg-red-500 rounded-full"
                    >
                        <FiX />
                    </button>
                </div>

                {/* Video Display */}
                {callState.isVideo && (
                    <div className="grid grid-cols-2 gap-4">
                        <video
                            ref={localVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full bg-gray-800 rounded-lg"
                        />
                        <video
                            ref={remoteVideoRef}
                            autoPlay
                            playsInline
                            className="w-full bg-gray-800 rounded-lg"
                        />
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="flex flex-col h-screen bg-gray-100">
            {/* Header with Connection Status */}
            <div className="bg-white shadow">
                <div className="flex items-center justify-between p-4">
                    <h1 className="text-xl font-bold">Chat Room</h1>
                    {/* {renderConnectionStatus()} */}
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((message) => {
                    console.log(message);

                    return (
                        <div
                            key={message.id}
                            className={`flex ${message.sender === 'me' ? 'justify-end' : 'justify-start'}`}
                        >
                            <div
                                className={`p-2 max-w-xs rounded-lg ${message.sender === "me"
                                    ? "ml-auto bg-blue-500 text-white"
                                    : message.sender === "system"
                                        ? "mx-auto bg-gray-500 text-white"
                                        : "bg-gray-200"
                                    }`}
                            >
                                {message.type === 'file' ? (
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2">
                                            {getFileIcon(message.fileType || '')}
                                            <span className="truncate">{message.fileName}</span>
                                        </div>
                                        <button
                                            onClick={() => message.fileUrl && window.open(message.fileUrl)}
                                            className="bg-white text-blue-500 px-3 py-1 rounded text-sm"
                                        >
                                            Download
                                        </button>
                                    </div>
                                ) : (
                                    <p>{message.text}</p>
                                )}
                                <span className="text-xs opacity-75 mt-1 block">
                                    {new Date(message.timestamp).toLocaleTimeString()}
                                </span>
                            </div>
                        </div>
                    )
                })}
                {/* <div ref={messagesEndRef} /> */}
            </div>

            {/* Input Area */}
            <div className="bg-white border-t p-4">
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 hover:bg-gray-100 rounded-full"
                    >
                        <FiPaperclip />
                    </button>

                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                        placeholder="Type a message..."
                        className="flex-1 p-2 border rounded-lg"
                    />

                    <button
                        onClick={() => startCall(false)}
                        className="p-2 hover:bg-gray-100 rounded-full"
                    >
                        <FiPhone />
                    </button>

                    <button
                        onClick={() => startCall(true)}
                        className="p-2 hover:bg-gray-100 rounded-full"
                    >
                        <FiVideo />
                    </button>

                    <button
                        onClick={sendMessage}
                        className="p-2 bg-blue-500 text-white rounded-full"
                    >
                        <FiSend />
                    </button>
                </div>
            </div>

            {/* Call UI */}
            {callState.isInCall && renderCallInterface()}

            {/* Incoming Call UI */}
            {callState.incomingCall && (
                <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center">
                    <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
                        <h3 className="text-xl font-semibold mb-4">
                            Incoming {callState.isVideo ? 'Video' : 'Audio'} Call
                        </h3>
                        <p className="mb-6">{callState.callerName} is calling...</p>
                        <div className="flex justify-center gap-4">
                            <button
                                onClick={acceptCall}
                                className="px-6 py-2 bg-green-500 text-white rounded-full"
                            >
                                Accept
                            </button>
                            <button
                                onClick={rejectCall}
                                className="px-6 py-2 bg-red-500 text-white rounded-full"
                            >
                                Reject
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Error Messages */}
            {error && (
                <div className="fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg">
                    {error}
                </div>
            )}
        </div>
    );
};

export default ChatRoom; 