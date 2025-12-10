export enum ToolType {
  PEN = 'PEN',
  HIGHLIGHTER = 'HIGHLIGHTER',
  ERASER = 'ERASER',
  LASER = 'LASER',
  RECTANGLE = 'RECTANGLE',
  CIRCLE = 'CIRCLE',
  ARROW = 'ARROW',
  TEXT = 'TEXT'
}

export interface Point {
  x: number;
  y: number;
  t?: number; // timestamp
}

export interface Stroke {
  id: string;
  tool: ToolType;
  points: Point[];
  color: string;
  width: number;
  isFilled?: boolean;
}

export interface Slide {
  id: string;
  thumbnailUrl: string; // Base64 or Blob URL
  fullUrl: string;      // Base64 or Blob URL
  strokes: Stroke[];
  notes: string;
}

export interface Project {
  id: string;
  name: string;
  lastModified: number;
  slides: Slide[];
}

export interface UserProfile {
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface DriveFolder {
  id: string;
  name: string;
}

export interface AppState {
  currentProject: Project | null;
  currentSlideIndex: number;
  tool: ToolType;
  strokeColor: string;
  strokeWidth: number;
  
  // Recording State
  isRecording: boolean;
  isPaused: boolean;
  recordingTime: number; // in seconds
  
  // UI State
  isDarkMode: boolean;
  isSidebarOpen: boolean;
  isAIPanelOpen: boolean;
  
  // Save/Upload State
  showSaveModal: boolean;
  recordedBlob: Blob | null;
  uploadProgress: number; // 0 to 100
  isUploading: boolean;
  userProfile: UserProfile | null;
  
  // Google Integration
  accessToken: string | null;
  driveFolders: DriveFolder[];
  selectedFolderId: string;
}

export interface GeminiChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface WhiteboardHandle {
  getCanvas: () => HTMLCanvasElement | null;
}