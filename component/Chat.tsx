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
    callerName: string | null;
    callStatus: 'idle' | 'calling' | 'rejected' | 'connected';
    callStartTime: number | null;
    callDuration: string;
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
        caller: null,
        callerName: null,
        callStatus: 'idle',
        callStartTime: null,
        callDuration: '00:00'
    });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    const [isTyping, setIsTyping] = useState<boolean>(false);
    const [remoteTyping, setRemoteTyping] = useState<boolean>(false);
    const typingTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    console.log(remoteTyping);

    useEffect(() => {
        debugger
        const socket = new WebSocket("ws:talented-empathy-production-e9b1.up.railway.app");

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
                    handleNewICECandidate(data);
                    break;

                case "call-rejected":
                    setCallState(prev => ({
                        ...prev,
                        callStatus: 'rejected'
                    }));
                    setTimeout(() => {
                        stopCall(true, true);
                    }, 2000);
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
                        callDuration: '00:00'
                    });

                    // Add call ended message
                    if (wasConnected) {
                        setMessages(prev => [...prev, {
                            text: `${endedCallType} call ended: ${endedCallDuration}`,
                            sender: 'system',
                            type: 'text'
                        }]);
                    }
                    break;

                case "typing":
                    debugger
                    if (data.sender !== userId) {
                        setRemoteTyping(data.isTyping);
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
            stopCall();
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
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' }
                ]
            });

            // Add connection state monitoring
            peerConnection.onconnectionstatechange = () => {
                console.log("Connection state:", peerConnection.connectionState);
                if (peerConnection.connectionState === 'failed') {
                    console.error("Connection failed - Please check your network connection");
                    stopCall();
                }
            };

            // Add ICE connection state monitoring
            peerConnection.oniceconnectionstatechange = () => {
                console.log("ICE connection state:", peerConnection.iceConnectionState);
                if (peerConnection.iceConnectionState === 'failed') {
                    console.error("ICE connection failed - Try using a different network");
                    stopCall();
                }
            };

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
                    target: "other",
                    isVideo,
                    caller: userId,
                    callerName: "User" // You can replace this with actual user name if available
                }));
            }

            setCallState({
                localStream: stream,
                remoteStream: null,
                peerConnection,
                isInCall: true,
                isVideo,
                incomingCall: false,
                caller: null,
                callerName: null,
                callStatus: 'calling',
                callStartTime: null,
                callDuration: '00:00'
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
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' }
                ]
            });

            // Add connection state monitoring
            peerConnection.onconnectionstatechange = () => {
                console.log("Connection state:", peerConnection.connectionState);
                if (peerConnection.connectionState === 'failed') {
                    console.error("Connection failed - Please check your network connection");
                    stopCall();
                }
            };

            // Add ICE connection state monitoring
            peerConnection.oniceconnectionstatechange = () => {
                console.log("ICE connection state:", peerConnection.iceConnectionState);
                if (peerConnection.iceConnectionState === 'failed') {
                    console.error("ICE connection failed - Try using a different network");
                    stopCall();
                }
            };

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
                caller: null,
                callerName: null,
                callStatus: 'connected',
                callStartTime: Date.now(),
                callDuration: '00:00'
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
                const startTime = Date.now();
                setCallState(prev => ({
                    ...prev,
                    callStatus: 'connected',
                    remoteStream: data.streams?.[0] || null,
                    callStartTime: startTime,
                    callDuration: '00:00'
                }));
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

    const stopCall = (fromRemote = false, isRejected = false) => {
        // Store current call info before cleanup
        const currentCallType = callState.isVideo ? 'Video' : 'Audio';
        const currentCallDuration = callState.callDuration;
        const wasConnected = callState.callStatus === 'connected';

        // Send call-ended message first (only if local user is ending and not rejecting)
        if (!fromRemote && !isRejected && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: "call-ended",
                target: "other",
                duration: currentCallDuration
            }));
        }

        // Stop all media tracks
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(track => track.stop());
        }

        // Close peer connection
        if (callState.peerConnection) {
            try {
                callState.peerConnection.getSenders().forEach(sender => {
                    if (sender.track) sender.track.stop();
                });
                callState.peerConnection.close();
            } catch (err) {
                console.error('Error closing peer connection:', err);
            }
        }

        // Clear video elements
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

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
            callDuration: '00:00'
        });

        // Add appropriate message based on call state
        if (isRejected) {
            setMessages(prev => [...prev, {
                text: `Call was rejected`,
                sender: 'system',
                type: 'text'
            }]);
        } else if (wasConnected && currentCallDuration !== '00:00') {
            setMessages(prev => [...prev, {
                text: `${currentCallType} call ended: ${currentCallDuration}`,
                sender: 'system',
                type: 'text'
            }]);
        }
    };


    // Update the cleanup effect to handle disconnections
    useEffect(() => {
        if (callState.peerConnection) {
            const handleConnectionStateChange = () => {
                const state = callState.peerConnection?.connectionState;
                console.log('Peer connection state changed:', state);

                if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                    console.log('Connection lost, cleaning up call...');
                    stopCall(true);
                }
            };

            const handleIceConnectionStateChange = () => {
                const state = callState.peerConnection?.iceConnectionState;
                console.log('ICE connection state changed:', state);

                if (state === 'disconnected' || state === 'failed' || state === 'closed') {
                    console.log('ICE connection lost, cleaning up call...');
                    stopCall();
                }
            };

            callState.peerConnection.addEventListener('connectionstatechange', handleConnectionStateChange);
            callState.peerConnection.addEventListener('iceconnectionstatechange', handleIceConnectionStateChange);

            return () => {
                callState.peerConnection?.removeEventListener('connectionstatechange', handleConnectionStateChange);
                callState.peerConnection?.removeEventListener('iceconnectionstatechange', handleIceConnectionStateChange);
            };
        }
    }, [callState.peerConnection]);

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

    const acceptCall = async () => {
        const storedData = sessionStorage.getItem('pendingOffer');
        if (storedData) {
            const data = JSON.parse(storedData);
            await handleIncomingCall(data);
            setCallState(prev => ({
                ...prev,
                callStatus: 'connected',
                callStartTime: Date.now()
            }));
            sessionStorage.removeItem('pendingOffer');
        }
    };

    const rejectCall = () => {
        if (ws && callState.caller) {
            ws.send(JSON.stringify({
                type: "call-rejected",
                target: callState.caller
            }));
        }

        // Clean up resources
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(track => track.stop());
        }
        if (callState.peerConnection) {
            callState.peerConnection.close();
        }

        // Reset state
        setCallState({
            localStream: null,
            remoteStream: null,
            peerConnection: null,
            isInCall: false,
            isVideo: false,
            incomingCall: false,
            caller: null,
            callerName: null,
            callStatus: 'rejected',
            callStartTime: null,
            callDuration: '00:00'
        });

        // Show rejection message
        setMessages(prev => [...prev, {
            text: 'Call was rejected',
            sender: 'system',
            type: 'text'
        }]);

        // Clear rejection state after delay
        setTimeout(() => {
            setCallState(prev => ({
                ...prev,
                callStatus: 'idle'
            }));
        }, 2000);

        sessionStorage.removeItem('pendingOffer');
    };

    const handleTyping = () => {
        if (!isTyping) {
            setIsTyping(true);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'typing',
                    isTyping: true,
                    sender: userId
                }));
            }
        }

        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }

        typingTimeoutRef.current = setTimeout(() => {
            setIsTyping(false);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'typing',
                    isTyping: false,
                    sender: userId
                }));
            }
        }, 2000);
    };

    console.log(callState.callStatus);


    return (
        <div className="flex flex-col h-screen bg-gray-100">
            {/* Header */}
            <div className="p-4 bg-blue-600 text-white text-lg font-bold">Chat</div>

            {/* Error/Notification Message */}
            {error && (
                <div className="fixed top-4 right-4 z-50 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
                    {error}
                </div>
            )}

            {/* Incoming Call UI */}
            {callState.incomingCall && !callState.isInCall && (
                <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center">
                    <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4">
                        <h3 className="text-xl font-semibold mb-4 text-center">
                            Incoming {callState.isVideo ? 'Video' : 'Audio'} Call
                        </h3>
                        <p className="text-center mb-6">
                            {callState.callerName} is calling...
                        </p>
                        <div className="flex justify-center space-x-4">
                            <button
                                onClick={acceptCall}
                                className="px-6 py-2 bg-green-500 text-white rounded-full hover:bg-green-600 flex items-center"
                            >
                                <FiPhone className="mr-2" />
                                Accept
                            </button>
                            <button
                                onClick={rejectCall}
                                className="px-6 py-2 bg-red-500 text-white rounded-full hover:bg-red-600 flex items-center"
                            >
                                <FiX className="mr-2" />
                                Reject
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Call Interface */}
            {callState.isInCall && (
                <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center">
                    <div className="relative w-full max-w-4xl p-4">
                        <div className="absolute top-4 right-4 flex items-center gap-4">
                            {callState.callStatus === 'connected' && (
                                <div className="bg-gray-800 text-white px-4 py-2 rounded-full">
                                    {callState.callDuration}
                                </div>
                            )}
                            <button
                                onClick={() => stopCall(false)}
                                className="p-2 bg-red-500 text-white rounded-full"
                            >
                                <FiX size={24} />
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {callState.isVideo ? (
                                <div className="col-span-2 relative">
                                    <div className="grid grid-cols-2 gap-4">
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
                                    </div>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center space-y-4">
                                        {callState.callStatus === 'calling' && (
                                            <div className="text-white text-xl bg-black bg-opacity-50 px-6 py-3 rounded-full">
                                                Calling...
                                            </div>
                                        )}
                                        {callState.callStatus === 'rejected' && (
                                            <div className="text-white text-xl bg-red-500 bg-opacity-90 px-6 py-3 rounded-full">
                                                Call Rejected
                                            </div>
                                        )}
                                        {callState.callStatus === 'connected' && (
                                            <button
                                                onClick={() => stopCall(false)}
                                                className="px-6 py-2 bg-red-500 text-white rounded-full hover:bg-red-600"
                                            >
                                                End Call 1
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="col-span-2 flex items-center justify-center h-48 bg-gray-800 rounded-lg">
                                    <div className="flex flex-col items-center space-y-4">
                                        <div className="text-white text-xl">
                                            {callState.callStatus === 'calling' && 'Calling...'}
                                            {callState.callStatus === 'rejected' && 'Call Rejected'}
                                            {callState.callStatus === 'connected' && 'Audio Call Connected'}
                                        </div>
                                        {callState.callStatus === 'connected' && (
                                            <button
                                                onClick={() => stopCall(false)}
                                                className="px-6 py-2 bg-red-500 text-white rounded-full hover:bg-red-600"
                                            >
                                                End Call
                                            </button>
                                        )}
                                    </div>
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
                        className={`p-2 max-w-xs rounded-lg ${msg.sender === "me"
                            ? "ml-auto bg-blue-500 text-white"
                            : msg.sender === "system"
                                ? "mx-auto bg-gray-500 text-white"
                                : "bg-gray-200"
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
                {remoteTyping && (
                    <div className="flex items-center space-x-2 text-gray-500 text-sm">
                        <span>Someone is typing</span>
                        <span className="animate-pulse">...</span>
                    </div>
                )}
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
                    onChange={(e) => {
                        setInput(e.target.value);
                        handleTyping();
                    }}
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