import React, { useState, useEffect, useRef } from 'react';
import { 
  Menu, ChevronLeft, ChevronRight, Mic, Square, 
  Download, Save, Bot, Sun, Moon, LogOut, X,
  Pause, Play, Trash2, User, Folder
} from 'lucide-react';

import Dashboard from './components/Dashboard';
import Whiteboard from './components/Whiteboard';
import { streamChatResponse } from './utils/gemini';
import { AppState, Project, ToolType, Stroke, GeminiChatMessage, WhiteboardHandle } from './types';
import { TOOLS, COLORS, STROKE_WIDTHS } from './constants';

// --- Globals for Google API ---
declare global {
  interface Window {
    google: any;
    gapi: any;
  }
}

// ENVIRONMENT VARIABLE DETECTION
// We check both Vite standard (import.meta.env) and Node standard (process.env)
const getEnvVar = (key: string) => {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
      // @ts-ignore
      return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key];
  }
  return "";
};

const INITIAL_CLIENT_ID = getEnvVar('VITE_GOOGLE_CLIENT_ID') || getEnvVar('GOOGLE_CLIENT_ID') || "";
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>({
    currentProject: null,
    currentSlideIndex: 0,
    tool: ToolType.PEN,
    strokeColor: COLORS[0],
    strokeWidth: 4,
    
    isRecording: false,
    isPaused: false,
    recordingTime: 0,

    isDarkMode: false,
    isSidebarOpen: true,
    isAIPanelOpen: false,

    showSaveModal: false,
    recordedBlob: null,
    uploadProgress: 0,
    isUploading: false,
    userProfile: null,

    accessToken: null,
    driveFolders: [],
    selectedFolderId: 'root'
  });

  // Client ID State (allows manual entry if env var is missing)
  const [clientId, setClientId] = useState(INITIAL_CLIENT_ID);
  
  const [savedProjects, setSavedProjects] = useState<Project[]>([]);
  const [chatHistory, setChatHistory] = useState<GeminiChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [videoFilename, setVideoFilename] = useState('');
  const [recordingMimeType, setRecordingMimeType] = useState<string>('video/webm');
  const [isLoginLoading, setIsLoginLoading] = useState(false);

  // Recording Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const whiteboardRef = useRef<WhiteboardHandle>(null);
  const timerIntervalRef = useRef<number | null>(null);
  
  // Google Auth Refs
  const tokenClientRef = useRef<any>(null);
  const gapiInitedRef = useRef(false);

  // Initialize Dark Mode
  useEffect(() => {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
      setAppState(s => ({ ...s, isDarkMode: true }));
    }
  }, []);

  // Initialize Google API Client
  useEffect(() => {
    const initializeGapiClient = () => {
      if (!window.gapi) return;
      window.gapi.load('client', async () => {
        try {
            await window.gapi.client.init({
                discoveryDocs: DISCOVERY_DOCS,
            });
            gapiInitedRef.current = true;
        } catch(e) {
            console.error("GAPI Init Error", e);
        }
      });
    };

    if (window.gapi) {
        initializeGapiClient();
    } else {
        const interval = setInterval(() => {
            if(window.gapi) {
                initializeGapiClient();
                clearInterval(interval);
            }
        }, 500);
    }
  }, []);

  // Initialize Google Identity Services (GIS)
  useEffect(() => {
    if (!clientId) return; // Don't init if no key

    const initTokenClient = () => {
        if (window.google?.accounts?.oauth2) {
            tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPES,
                callback: async (tokenResponse: any) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        setAppState(s => ({ ...s, accessToken: tokenResponse.access_token }));
                        await fetchUserProfile(tokenResponse.access_token);
                        await fetchDriveFolders(tokenResponse.access_token);
                        setIsLoginLoading(false);
                    }
                },
            });
        }
    };

    if (window.google) {
        initTokenClient();
    } else {
         const interval = setInterval(() => {
            if(window.google) {
                initTokenClient();
                clearInterval(interval);
            }
        }, 500);
    }
  }, [clientId]); // Re-run if user manually updates client ID

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  // --- Google API Helpers ---

  const fetchUserProfile = async (token: string) => {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        setAppState(s => ({
            ...s,
            userProfile: {
                name: data.name,
                email: data.email,
                avatarUrl: data.picture
            }
        }));
    } catch (e) {
        console.error("Failed to fetch user profile", e);
    }
  };

  const fetchDriveFolders = async (token: string) => {
      try {
          const query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
          const response = await window.gapi.client.drive.files.list({
              'pageSize': 20,
              'fields': "nextPageToken, files(id, name)",
              'q': query
          });
          const folders = response.result.files;
          setAppState(s => ({ ...s, driveFolders: folders || [] }));
      } catch (e) {
          console.error("Error fetching folders", e);
      }
  };

  const handleGoogleLogin = () => {
      if (!clientId) {
          alert("Please enter a Google Client ID first.");
          return;
      }
      setIsLoginLoading(true);
      if (tokenClientRef.current) {
          tokenClientRef.current.requestAccessToken();
      } else {
          // If the script loaded late, try to re-init immediately
          if (window.google?.accounts?.oauth2) {
             tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: SCOPES,
                callback: async (tokenResponse: any) => {
                    if (tokenResponse && tokenResponse.access_token) {
                        setAppState(s => ({ ...s, accessToken: tokenResponse.access_token }));
                        await fetchUserProfile(tokenResponse.access_token);
                        await fetchDriveFolders(tokenResponse.access_token);
                        setIsLoginLoading(false);
                    }
                },
             });
             tokenClientRef.current.requestAccessToken();
          } else {
             alert("Google Auth library not initialized yet. Please check your internet connection.");
             setIsLoginLoading(false);
          }
      }
  };


  const toggleDarkMode = () => {
    setAppState(s => {
      const newMode = !s.isDarkMode;
      if (newMode) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      return { ...s, isDarkMode: newMode };
    });
  };

  const startProject = (project: Project) => {
    setAppState(s => ({ ...s, currentProject: project, currentSlideIndex: 0 }));
  };

  const updateSlideStrokes = (slideId: string, strokes: Stroke[]) => {
    if (!appState.currentProject) return;
    
    const updatedSlides = appState.currentProject.slides.map(s => 
      s.id === slideId ? { ...s, strokes } : s
    );
    
    setAppState(s => ({
      ...s,
      currentProject: { ...s.currentProject!, slides: updatedSlides }
    }));
  };

  const handleClearSlide = () => {
      if (!appState.currentProject) return;
      const currentSlideId = appState.currentProject.slides[appState.currentSlideIndex].id;
      updateSlideStrokes(currentSlideId, []);
  };

  const nextSlide = () => {
    if (!appState.currentProject) return;
    if (appState.currentSlideIndex < appState.currentProject.slides.length - 1) {
      setAppState(s => ({ ...s, currentSlideIndex: s.currentSlideIndex + 1 }));
    }
  };

  const prevSlide = () => {
    if (appState.currentSlideIndex > 0) {
      setAppState(s => ({ ...s, currentSlideIndex: s.currentSlideIndex - 1 }));
    }
  };

  // --- Recording Logic ---

  const startRecording = async () => {
    try {
      const canvas = whiteboardRef.current?.getCanvas();
      if (!canvas) {
        alert("Whiteboard not initialized. Please try again.");
        return;
      }
      
      const canvasStream = canvas.captureStream(30);
      const videoTrack = canvasStream.getVideoTracks()[0];

      let audioStream: MediaStream | null = null;
      try {
          audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
          console.warn("Microphone access denied or unavailable", e);
      }

      const combinedStream = new MediaStream([
        videoTrack,
        ...(audioStream ? audioStream.getAudioTracks() : []),
      ]);
      streamRef.current = combinedStream;

      let mimeType = 'video/webm';
      if (MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
        mimeType = 'video/webm;codecs=h264';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
      }
      setRecordingMimeType(mimeType);

      const recorder = new MediaRecorder(combinedStream, { mimeType });
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
        if (timerIntervalRef.current) window.clearInterval(timerIntervalRef.current);

        setAppState(s => ({ 
            ...s, 
            isRecording: false, 
            isPaused: false,
            showSaveModal: true,
            recordedBlob: blob
        }));
        setVideoFilename(`lesson-${new Date().toISOString().slice(0,10)}`);
      };

      recorder.start(1000); 
      
      timerIntervalRef.current = window.setInterval(() => {
          setAppState(s => {
              if (s.isPaused) return s;
              return { ...s, recordingTime: s.recordingTime + 1 };
          });
      }, 1000);

      setAppState(s => ({ ...s, isRecording: true, isPaused: false, recordingTime: 0 }));

    } catch (err: any) {
      console.error("Recording failed", err);
      alert("Could not start recording: " + err.message);
    }
  };

  const pauseRecording = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.pause();
          setAppState(s => ({ ...s, isPaused: true }));
      }
  };

  const resumeRecording = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
          mediaRecorderRef.current.resume();
          setAppState(s => ({ ...s, isPaused: false }));
      }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
    }
  };

  const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDownload = () => {
      if (!appState.recordedBlob) return;
      const url = URL.createObjectURL(appState.recordedBlob);
      const a = document.createElement('a');
      a.href = url;
      const ext = recordingMimeType.includes('mp4') ? 'mp4' : 'webm';
      a.download = `${videoFilename}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const handleDriveUpload = async () => {
      if (!appState.recordedBlob || !appState.accessToken) return;
      
      setAppState(s => ({ ...s, isUploading: true, uploadProgress: 0 }));

      try {
          const metadata = {
              name: `${videoFilename}.${recordingMimeType.includes('mp4') ? 'mp4' : 'webm'}`,
              mimeType: recordingMimeType,
              parents: appState.selectedFolderId === 'root' ? [] : [appState.selectedFolderId]
          };

          const formData = new FormData();
          formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
          formData.append('file', appState.recordedBlob);

          const xhr = new XMLHttpRequest();
          xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
          xhr.setRequestHeader('Authorization', `Bearer ${appState.accessToken}`);
          
          xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                  const percentComplete = (e.loaded / e.total) * 100;
                  setAppState(s => ({ ...s, uploadProgress: percentComplete }));
              }
          };

          xhr.onload = () => {
              if (xhr.status === 200) {
                   const response = JSON.parse(xhr.responseText);
                   alert(`Success! File uploaded with ID: ${response.id}`);
                   setAppState(s => ({ ...s, isUploading: false, showSaveModal: false }));
              } else {
                   console.error("Upload failed", xhr.responseText);
                   alert("Upload failed: " + xhr.statusText);
                   setAppState(s => ({ ...s, isUploading: false }));
              }
          };

          xhr.onerror = () => {
              alert("Network Error during upload");
              setAppState(s => ({ ...s, isUploading: false }));
          };

          xhr.send(formData);

      } catch (err) {
          console.error("Upload Logic Error", err);
          alert("An error occurred starting the upload.");
          setAppState(s => ({ ...s, isUploading: false }));
      }
  };

  // --- AI Chat Logic ---
  const handleSendMessage = async () => {
    if (!aiInput.trim()) return;
    const userMsg = { role: 'user' as const, text: aiInput };
    setChatHistory(prev => [...prev, userMsg]);
    setAiInput('');
    setIsAiLoading(true);

    try {
        const historyForApi = chatHistory.map(m => ({
            role: m.role,
            parts: [{ text: m.text }]
        }));
        const responseStream = streamChatResponse(historyForApi, userMsg.text);
        let fullResponse = "";
        setChatHistory(prev => [...prev, { role: 'model', text: '' }]);

        for await (const chunk of responseStream) {
            fullResponse += chunk;
            setChatHistory(prev => {
                const newHist = [...prev];
                newHist[newHist.length - 1] = { role: 'model', text: fullResponse };
                return newHist;
            });
        }
    } catch (e) {
        setChatHistory(prev => [...prev, { role: 'model', text: "Error: Could not reach Gemini AI." }]);
    } finally {
        setIsAiLoading(false);
    }
  };

  // Render
  if (!appState.currentProject) {
    return <Dashboard onProjectStart={startProject} savedProjects={savedProjects} />;
  }

  const currentSlide = appState.currentProject.slides[appState.currentSlideIndex];

  return (
    <div className="flex h-screen w-screen bg-gray-100 dark:bg-gray-900 overflow-hidden font-sans">
      
      {/* --- Save Video Modal --- */}
      {appState.showSaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Save Lesson Recording</h2>
                      {!appState.isUploading && (
                        <button onClick={() => setAppState(s => ({...s, showSaveModal: false}))}>
                           <X className="text-gray-500 hover:text-red-500" />
                        </button>
                      )}
                  </div>
                  
                  <div className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Filename</label>
                          <input 
                              type="text" 
                              value={videoFilename}
                              onChange={(e) => setVideoFilename(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500"
                              placeholder="Lesson Name"
                          />
                      </div>

                      {appState.isUploading ? (
                          <div className="space-y-2 py-4">
                              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
                                  <span>Uploading to Google Drive...</span>
                                  <span>{Math.round(appState.uploadProgress)}%</span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                                  <div 
                                    className="bg-brand-500 h-2.5 rounded-full transition-all duration-300" 
                                    style={{ width: `${appState.uploadProgress}%` }}
                                  ></div>
                              </div>
                          </div>
                      ) : (
                          <div className="grid grid-cols-1 gap-3 pt-2">
                              <button 
                                  onClick={handleDownload}
                                  className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-white rounded-xl font-medium transition-colors"
                              >
                                  <Download size={20} />
                                  Download to Device ({recordingMimeType.includes('mp4') ? 'MP4' : 'WebM'})
                              </button>
                              
                              <div className="relative border-t border-gray-200 dark:border-gray-600 my-2">
                                  <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-gray-800 px-2 text-xs text-gray-500">OR</span>
                              </div>

                              {!clientId ? (
                                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-xl border border-yellow-200 dark:border-yellow-800">
                                     <p className="text-sm text-yellow-800 dark:text-yellow-200 mb-2 font-medium">
                                        Setup Required for Drive Upload
                                     </p>
                                     <p className="text-xs text-yellow-700 dark:text-yellow-300 mb-2">
                                        To enable Google Drive upload, you need to provide a Google OAuth Client ID. 
                                     </p>
                                     <input 
                                       type="text" 
                                       placeholder="Paste Google Client ID here..."
                                       className="w-full text-xs p-2 rounded border border-yellow-300 dark:border-yellow-700 dark:bg-gray-900 dark:text-white"
                                       onChange={(e) => setClientId(e.target.value)}
                                     />
                                     <div className="mt-2 text-[10px] text-gray-500">
                                        Don't have one? Create one in Google Cloud Console.
                                     </div>
                                  </div>
                              ) : (
                                  !appState.userProfile ? (
                                      <button 
                                        onClick={handleGoogleLogin}
                                        disabled={isLoginLoading}
                                        className="flex items-center justify-center gap-2 w-full py-3 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-xl font-medium transition-colors text-gray-700 dark:text-gray-200"
                                      >
                                        {isLoginLoading ? (
                                            <div className="w-5 h-5 border-2 border-gray-400 border-t-brand-500 rounded-full animate-spin"></div>
                                        ) : (
                                            <svg viewBox="0 0 24 24" width="20" height="20">
                                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                            </svg>
                                        )}
                                        Sign in with Google
                                      </button>
                                  ) : (
                                      <div className="space-y-3">
                                          <div className="flex items-center space-x-3 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                              {appState.userProfile.avatarUrl ? (
                                                  <img src={appState.userProfile.avatarUrl} alt="Avatar" className="w-8 h-8 rounded-full" />
                                              ) : (
                                                  <div className="w-8 h-8 bg-brand-100 text-brand-600 rounded-full flex items-center justify-center"><User size={16}/></div>
                                              )}
                                              <div className="flex-1 overflow-hidden">
                                                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{appState.userProfile.name}</p>
                                                  <p className="text-xs text-gray-500 truncate">{appState.userProfile.email}</p>
                                              </div>
                                          </div>

                                          {/* Folder Selection */}
                                          <div>
                                              <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1">
                                                  <Folder size={12}/> Select Drive Folder
                                              </label>
                                              <select 
                                                value={appState.selectedFolderId}
                                                onChange={(e) => setAppState(s => ({ ...s, selectedFolderId: e.target.value }))}
                                                className="w-full text-sm p-2 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                                              >
                                                  <option value="root">My Drive (Root)</option>
                                                  {appState.driveFolders.map(folder => (
                                                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                                                  ))}
                                              </select>
                                          </div>

                                          <button 
                                              onClick={handleDriveUpload}
                                              className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-blue-500/20"
                                          >
                                              <div className="bg-white p-0.5 rounded-sm">
                                                  <svg viewBox="0 0 87.3 78" width="16" height="14">
                                                  <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.9 2.5 3.2 3.3l12.3-21.3h-26l6.65 11.35Z" fill="#0066da"/>
                                                  <path d="m43.65 25-12.3-21.3c-1.3.8-2.4 1.9-3.2 3.3l-25.4 44a8.6 8.6 0 0 0-.65 7.6l12.95-22.3 15.65-25.3c10.45 6 12.25 10.95 12.95 14Z" fill="#00ac47"/>
                                                  <path d="m73.55 66.85 6.65-11.35-13.6-23.7h-26l12.3 21.3 12.95 22.3c3.05-1.75 5.55-4.5 7.7-8.55Z" fill="#ea4335"/>
                                                  <path d="m43.65 25 12.95 22.3 12.95 22.3c2.15-3.7 3.05-7.9 2.6-12.1l-12.95-22.45-15.55-26.05Z" fill="#00832d"/>
                                                  <path d="m59.95 53.2h-25.95l-12.3-21.3-13 22.5 12.95 22.3h46.3c-.45-4.2-1.35-8.4-3.5-12.1l-4.5-11.4Z" fill="#2684fc"/>
                                                  <path d="m16.05 25h27.6l13-22.5c-2.45-1.55-5.25-2.5-8.15-2.5h-45.5l13 25Z" fill="#ffba00"/>
                                                  </svg>
                                              </div>
                                              Upload to Drive
                                          </button>
                                      </div>
                                  )
                              )}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* --- Sidebar (Slides) --- */}
      {appState.isSidebarOpen && (
        <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col shrink-0 transition-all">
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h2 className="font-bold text-gray-700 dark:text-gray-200 truncate">{appState.currentProject.name}</h2>
            <button onClick={() => setAppState(s => ({ ...s, isSidebarOpen: false }))} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <ChevronLeft size={20} className="text-gray-500" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {appState.currentProject.slides.map((slide, idx) => (
              <div 
                key={slide.id}
                onClick={() => setAppState(s => ({ ...s, currentSlideIndex: idx }))}
                className={`cursor-pointer rounded-lg border-2 overflow-hidden transition-all ${
                  idx === appState.currentSlideIndex 
                    ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900' 
                    : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <div className="aspect-video bg-gray-200 dark:bg-gray-900 relative">
                  {slide.thumbnailUrl ? (
                    <img src={slide.thumbnailUrl} alt={`Slide ${idx + 1}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">Blank</div>
                  )}
                  <div className="absolute bottom-1 right-1 bg-black/50 text-white text-xs px-1.5 rounded">
                    {idx + 1}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-gray-200 dark:border-gray-700">
             <button 
                onClick={() => setAppState(s => ({...s, currentProject: null}))}
                className="flex items-center space-x-2 text-red-500 hover:text-red-600 w-full justify-center p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
             >
                <LogOut size={16} />
                <span>Exit Lesson</span>
             </button>
          </div>
        </div>
      )}

      {/* --- Main Content --- */}
      <div className="flex-1 flex flex-col relative h-full">
        
        {/* Top Toolbar */}
        <div className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-4 shrink-0 z-20">
            
            <div className="flex items-center space-x-2">
                {!appState.isSidebarOpen && (
                    <button onClick={() => setAppState(s => ({ ...s, isSidebarOpen: true }))} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded mr-2">
                        <Menu size={20} className="text-gray-600 dark:text-gray-300" />
                    </button>
                )}
                
                {/* Tools */}
                <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 space-x-1">
                    {TOOLS.map((tool) => (
                        <button
                            key={tool.id}
                            onClick={() => setAppState(s => ({ ...s, tool: tool.id }))}
                            title={tool.label}
                            className={`p-2 rounded transition-colors ${
                                appState.tool === tool.id 
                                ? 'bg-white dark:bg-gray-600 shadow text-brand-600 dark:text-brand-400' 
                                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                            }`}
                        >
                            <tool.icon size={20} />
                        </button>
                    ))}
                    
                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 self-center mx-1"></div>
                    
                    <button
                        onClick={handleClearSlide}
                        title="Clear Slide"
                        className="p-2 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                    >
                        <Trash2 size={20} />
                    </button>
                </div>

                <div className="h-8 w-px bg-gray-300 dark:bg-gray-600 mx-2" />
                
                <div className="flex items-center space-x-2">
                    {COLORS.map(c => (
                        <button
                            key={c}
                            onClick={() => setAppState(s => ({ ...s, strokeColor: c }))}
                            className={`w-6 h-6 rounded-full border border-gray-300 dark:border-gray-600 ${
                                appState.strokeColor === c ? 'ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-gray-800' : ''
                            }`}
                            style={{ backgroundColor: c }}
                        />
                    ))}
                </div>

                <div className="h-8 w-px bg-gray-300 dark:bg-gray-600 mx-2" />
                
                <select 
                    value={appState.strokeWidth}
                    onChange={(e) => setAppState(s => ({ ...s, strokeWidth: Number(e.target.value) }))}
                    className="bg-transparent border border-gray-300 dark:border-gray-600 rounded text-sm p-1 text-gray-700 dark:text-gray-300 focus:outline-none"
                >
                    {STROKE_WIDTHS.map(w => (
                        <option key={w} value={w}>{w}px</option>
                    ))}
                </select>
            </div>

            {/* Right Actions */}
            <div className="flex items-center space-x-4">
                 <button onClick={toggleDarkMode} className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full">
                    {appState.isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                 </button>

                 {/* Record Button Group */}
                 <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-full p-1 border border-gray-200 dark:border-gray-600">
                    {!appState.isRecording ? (
                        <button 
                            onClick={startRecording}
                            className="flex items-center space-x-2 px-4 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded-full transition-colors"
                        >
                            <Mic size={16} />
                            <span className="text-sm font-medium">Record</span>
                        </button>
                    ) : (
                        <>
                            <div className="flex items-center px-3 space-x-2 border-r border-gray-300 dark:border-gray-500">
                                <div className={`w-2.5 h-2.5 rounded-full ${appState.isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}`} />
                                <span className="text-sm font-mono font-medium text-gray-700 dark:text-gray-200">
                                    {formatTime(appState.recordingTime)}
                                </span>
                            </div>
                            
                            {appState.isPaused ? (
                                <button onClick={resumeRecording} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full text-green-600" title="Resume">
                                    <Play size={18} className="fill-current" />
                                </button>
                            ) : (
                                <button onClick={pauseRecording} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full text-yellow-600" title="Pause">
                                    <Pause size={18} className="fill-current" />
                                </button>
                            )}

                            <button onClick={stopRecording} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full text-red-600" title="Stop & Save">
                                <Square size={18} className="fill-current" />
                            </button>
                        </>
                    )}
                 </div>

                 <button 
                    onClick={() => setAppState(s => ({ ...s, isAIPanelOpen: !s.isAIPanelOpen }))}
                    className={`p-2 rounded-full border transition-all ${
                        appState.isAIPanelOpen 
                        ? 'bg-brand-50 border-brand-200 text-brand-600 dark:bg-brand-900/30 dark:border-brand-700 dark:text-brand-400' 
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700'
                    }`}
                 >
                    <Bot size={20} />
                 </button>
            </div>
        </div>

        {/* Whiteboard Area */}
        <div className="flex-1 relative bg-gray-100 dark:bg-gray-900 overflow-hidden flex items-center justify-center p-4">
           <div className="w-full h-full max-w-6xl max-h-full aspect-video shadow-2xl rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-white dark:bg-black">
              <Whiteboard 
                ref={whiteboardRef}
                slide={currentSlide}
                tool={appState.tool}
                color={appState.strokeColor}
                width={appState.strokeWidth}
                onUpdateSlide={updateSlideStrokes}
              />
           </div>

           {/* Navigation Overlays */}
           <button 
              onClick={prevSlide}
              disabled={appState.currentSlideIndex === 0}
              className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/80 dark:bg-gray-800/80 rounded-full shadow-lg backdrop-blur hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
           >
              <ChevronLeft size={24} className="text-gray-800 dark:text-white" />
           </button>
           <button 
              onClick={nextSlide}
              disabled={appState.currentSlideIndex === appState.currentProject.slides.length - 1}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/80 dark:bg-gray-800/80 rounded-full shadow-lg backdrop-blur hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
           >
              <ChevronRight size={24} className="text-gray-800 dark:text-white" />
           </button>
        </div>

        {/* --- AI Panel --- */}
        {appState.isAIPanelOpen && (
            <div className="absolute right-4 bottom-4 top-20 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col z-30">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-brand-50 dark:bg-gray-800 rounded-t-xl">
                    <div className="flex items-center space-x-2 text-brand-700 dark:text-brand-400">
                        <Bot size={20} />
                        <span className="font-semibold">AI Assistant</span>
                    </div>
                    <button onClick={() => setAppState(s => ({...s, isAIPanelOpen: false}))}>
                        <X size={18} className="text-gray-500 hover:text-gray-700" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {chatHistory.length === 0 && (
                        <div className="text-center text-gray-500 dark:text-gray-400 mt-10 text-sm">
                            <p>Ask me to generate a lesson plan or explain a concept!</p>
                            <button 
                                onClick={() => {
                                    setAiInput("Create a lesson plan for this topic.");
                                }}
                                className="mt-4 px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs hover:bg-gray-200"
                            >
                                Try: "Create lesson plan"
                            </button>
                        </div>
                    )}
                    {chatHistory.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] rounded-lg p-3 text-sm ${
                                msg.role === 'user' 
                                ? 'bg-brand-500 text-white' 
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                            }`}>
                                {msg.text}
                            </div>
                        </div>
                    ))}
                    {isAiLoading && (
                         <div className="flex justify-start">
                            <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
                                <div className="flex space-x-1">
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75" />
                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150" />
                                </div>
                            </div>
                         </div>
                    )}
                </div>

                <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex space-x-2">
                        <input
                            type="text"
                            value={aiInput}
                            onChange={(e) => setAiInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder="Ask Gemini..."
                            className="flex-1 bg-gray-100 dark:bg-gray-900 border-none rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 dark:text-white"
                        />
                        <button 
                            onClick={handleSendMessage}
                            disabled={isAiLoading || !aiInput.trim()}
                            className="bg-brand-500 text-white p-2 rounded-lg hover:bg-brand-600 disabled:opacity-50"
                        >
                            <ArrowRightIcon size={18} />
                        </button>
                    </div>
                </div>
            </div>
        )}

      </div>
    </div>
  );
};

// Helper component for icon just for this file
const ArrowRightIcon = ({size}: {size:number}) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
);

export default App;