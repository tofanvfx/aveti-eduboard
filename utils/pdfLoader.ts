import { Slide } from "../types";

// Define PDFJS types (partial) since we are loading via CDN
declare global {
  const pdfjsLib: {
    getDocument: (src: any) => any;
    GlobalWorkerOptions: {
      workerSrc: string;
    };
  };
}

export const loadPdfAsSlides = async (file: File): Promise<Slide[]> => {
  const arrayBuffer = await file.arrayBuffer();
  
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    const slides: Slide[] = [];

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      
      // High resolution for main view
      const viewport = page.getViewport({ scale: 2.0 }); 
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      if (!context) continue;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      const fullUrl = canvas.toDataURL('image/jpeg', 0.9);

      // Low resolution for thumbnail
      const thumbViewport = page.getViewport({ scale: 0.3 });
      const thumbCanvas = document.createElement('canvas');
      const thumbContext = thumbCanvas.getContext('2d');
      
      if(thumbContext) {
          thumbCanvas.height = thumbViewport.height;
          thumbCanvas.width = thumbViewport.width;
          
          await page.render({
            canvasContext: thumbContext,
            viewport: thumbViewport
          }).promise;
      }
      
      const thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.8);

      slides.push({
        id: crypto.randomUUID(),
        fullUrl,
        thumbnailUrl,
        strokes: [],
        notes: ''
      });
    }

    return slides;
  } catch (error) {
    console.error("Error parsing PDF:", error);
    throw new Error("Failed to load PDF. Please try a valid file.");
  }
};