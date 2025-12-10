import { ToolType } from "./types";
import { 
  Pencil, 
  Highlighter, 
  Eraser, 
  Square, 
  Circle, 
  ArrowRight, 
  Sparkles
} from "lucide-react";

export const TOOLS = [
  { id: ToolType.PEN, icon: Pencil, label: "Pen" },
  { id: ToolType.HIGHLIGHTER, icon: Highlighter, label: "Highlighter" },
  { id: ToolType.LASER, icon: Sparkles, label: "Laser Pointer" },
  { id: ToolType.ERASER, icon: Eraser, label: "Eraser" },
  { id: ToolType.RECTANGLE, icon: Square, label: "Box" },
  { id: ToolType.CIRCLE, icon: Circle, label: "Circle" },
  { id: ToolType.ARROW, icon: ArrowRight, label: "Arrow" },
];

export const COLORS = [
  "#000000", // Black
  "#EF4444", // Red
  "#3B82F6", // Blue
  "#10B981", // Green
  "#F59E0B", // Yellow (good for highlighter)
  "#8B5CF6", // Purple
  "#FFFFFF", // White (dark mode contrast)
];

export const STROKE_WIDTHS = [2, 4, 8, 12, 20];

export const GEMINI_MODEL = "gemini-2.5-flash";