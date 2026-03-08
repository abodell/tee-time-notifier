import React, { useRef, useState } from 'react';
import type { GlobalState } from '../types';
import { toPng } from 'html-to-image';
import { Download, Loader2 } from 'lucide-react';
import { TemplateRenderer } from './TemplateRenderer';

interface CanvasProps {
    state: GlobalState;
}

export const Canvas: React.FC<CanvasProps> = ({ state }) => {
    const canvasRef = useRef<HTMLDivElement>(null);
    const [isExporting, setIsExporting] = useState(false);

    // We determine the export width/height based on the template logic.
    // Legacy grid is 1080x1080. Everything else is 1080x1920 (Reel/Story).
    const isSquare = state.templateId === 'grid';
    const width = 1080;
    const height = isSquare ? 1080 : 1920;

    // Calculate a scale factor to fit the 1080x1920 element smoothly into the viewer.
    // We'll use CSS scale to shrink it for preview, but export it at 1x scale at 1080x1920.
    const previewScale = isSquare ? 0.45 : 0.35;

    const handleExport = async () => {
        if (!canvasRef.current) return;
        setIsExporting(true);
        try {
            // Small pause to let any final fonts/images render
            await new Promise(r => setTimeout(r, 100));

            const dataUrl = await toPng(canvasRef.current, {
                quality: 1.0,
                pixelRatio: 1, // Ensure native 1080x1920, no retina multiplier needed since we modeled at 1080
                width,
                height,
                style: {
                    transform: 'scale(1)', // Negate the CSS scale used for previewing!
                    transformOrigin: 'top left',
                }
            });

            const link = document.createElement('a');
            link.download = `teesignal-${state.templateId}-${Date.now()}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error('Failed to export image:', err);
            alert('Failed to export image. See console.');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="canvas-area" style={{ position: 'relative' }}>

            {/* Export Action Strip overlaying top right of Canvas Area */}
            <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', zIndex: 10 }}>
                <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="btn-primary"
                    style={{ width: 'auto', padding: '0.75rem 1.25rem', borderRadius: '2rem', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
                >
                    {isExporting ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                    <span>{isExporting ? 'Exporting...' : 'Export High-Res PNG'}</span>
                </button>
            </div>

            {/* 
        This is the actual Container we export. 
        It is FIXED at exactly 1080x1920 (or 1080x1080). 
        We use CSS transform: scale() just to make it fit on the monitor.
      */}
            <div
                style={{
                    width: `${width}px`,
                    height: `${height}px`,
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'center center',
                    boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
                    backgroundColor: '#000',
                    position: 'relative',
                    overflow: 'hidden'
                }}
            >
                <div ref={canvasRef} style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#000' }}>
                    <TemplateRenderer state={state} />
                </div>
            </div>

        </div>
    );
};
