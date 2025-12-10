import React, { useRef, useState } from 'react';
import { Upload, FileText, MonitorPlay, X, MonitorUp } from 'lucide-react';
import { loadPdfAsSlides } from '../utils/pdfLoader';
import { Project } from '../types';

interface DashboardProps {
  onProjectStart: (project: Project, startScreenShare?: boolean) => void;
  savedProjects: Project[]; // In a real app, this would come from local storage or DB
}

const Dashboard: React.FC<DashboardProps> = ({ onProjectStart, savedProjects }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const slides = await loadPdfAsSlides(file);
      const newProject: Project = {
        id: crypto.randomUUID(),
        name: file.name.replace('.pdf', ''),
        lastModified: Date.now(),
        slides: slides
      };
      onProjectStart(newProject);
    } catch (err) {
      alert("Failed to load PDF. Ensure it is a valid file.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-6">
      <div className="max-w-6xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">EduBoard AI</h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            Import your slides, annotate live, and record your lesson with AI assistance.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* New Project Card */}
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all cursor-pointer border-2 border-dashed border-brand-500 flex flex-col items-center justify-center group h-64"
          >
            <input 
              type="file" 
              accept=".pdf" 
              ref={fileInputRef} 
              className="hidden" 
              onChange={handleFileUpload}
            />
            {isLoading ? (
               <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-500 mb-4"></div>
            ) : (
              <div className="bg-brand-50 dark:bg-gray-700 p-4 rounded-full mb-4 group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8 text-brand-500 dark:text-brand-400" />
              </div>
            )}
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              {isLoading ? "Processing PDF..." : "Import PDF / PPT"}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm text-center">
              Supports .pdf (Convert PPT to PDF for best results)
            </p>
          </div>

          {/* Start Blank Whiteboard */}
          <div 
             onClick={() => {
                const blankSlide = {
                    id: crypto.randomUUID(),
                    fullUrl: "", // Empty string implies white background
                    thumbnailUrl: "",
                    strokes: [],
                    notes: ""
                };
                onProjectStart({
                    id: crypto.randomUUID(),
                    name: "Untitled Lesson",
                    lastModified: Date.now(),
                    slides: [blankSlide]
                })
             }}
            className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all cursor-pointer border border-transparent hover:border-gray-200 dark:hover:border-gray-700 flex flex-col items-center justify-center h-64"
          >
            <div className="bg-purple-50 dark:bg-gray-700 p-4 rounded-full mb-4">
               <MonitorPlay className="w-8 h-8 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Start Blank Whiteboard
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Start teaching from scratch without slides
            </p>
          </div>

          {/* Start Screen Annotation */}
          <div 
             onClick={() => {
                const blankSlide = {
                    id: crypto.randomUUID(),
                    fullUrl: "", 
                    thumbnailUrl: "",
                    strokes: [],
                    notes: ""
                };
                onProjectStart({
                    id: crypto.randomUUID(),
                    name: "Screen Annotation",
                    lastModified: Date.now(),
                    slides: [blankSlide]
                }, true)
             }}
            className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all cursor-pointer border border-transparent hover:border-gray-200 dark:hover:border-gray-700 flex flex-col items-center justify-center h-64"
          >
            <div className="bg-blue-50 dark:bg-gray-700 p-4 rounded-full mb-4">
               <MonitorUp className="w-8 h-8 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Annotate Screen
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm text-center">
              Share your desktop screen and write over it live
            </p>
          </div>
        </div>

        {savedProjects.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Recent Sessions</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {savedProjects.map((proj) => (
                <div key={proj.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="bg-gray-100 dark:bg-gray-700 p-2 rounded-lg">
                      <FileText className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </div>
                    <div>
                      <h4 className="font-medium text-gray-900 dark:text-white truncate max-w-[150px]">{proj.name}</h4>
                      <p className="text-xs text-gray-500">{new Date(proj.lastModified).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <button onClick={() => onProjectStart(proj)} className="text-brand-600 hover:text-brand-700 text-sm font-medium">
                    Open
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;