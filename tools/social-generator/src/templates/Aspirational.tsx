import React from 'react';
import type { GlobalState } from '../types';

export const Aspirational: React.FC<{ state: GlobalState }> = ({ state }) => {
    const bgStyle = state.backgroundImage
        ? { backgroundImage: `url(${state.backgroundImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
        : { background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' };

    return (
        <div
            style={{
                width: 1080,
                height: 1920,
                backgroundColor: '#000',
                color: '#fff',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                ...bgStyle
            }}
        >
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 100%)' }} />

            <div style={{ position: 'absolute', top: 240, left: 40, right: 40, textAlign: 'center', zIndex: 10 }}>
                <h2 style={{
                    fontSize: 72,
                    fontWeight: 700,
                    color: '#fff',
                    fontFamily: 'Outfit, sans-serif',
                    textShadow: '0 8px 32px rgba(0,0,0,0.8)',
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1
                }}>
                    {state.customText1 || "POV: You didn't mash refresh for 3 hours"}
                </h2>
            </div>

            <div style={{
                width: 900,
                background: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                borderRadius: 48,
                border: '2px solid rgba(255,255,255,0.3)',
                boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
                padding: '40px 48px',
                zIndex: 20,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 40
            }}>
                <img
                    src="/icon.png"
                    style={{ width: 120, height: 120, borderRadius: 28, flexShrink: 0, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', backgroundColor: '#fff' }}
                />

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <span style={{ fontSize: 36, fontWeight: 600, color: 'rgba(255,255,255,0.9)', letterSpacing: '0.01em' }}>TeeSignal</span>
                        <span style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)' }}>{state.customText4 || "just now"}</span>
                    </div>
                    <span style={{ fontSize: 44, fontWeight: 700, color: '#fff', marginBottom: 12, lineHeight: 1.2 }}>
                        {state.customText3 || "Tee Time Found!"}
                    </span>
                    <span style={{ fontSize: 40, fontWeight: 400, color: 'rgba(255,255,255,0.9)', lineHeight: 1.4 }}>
                        Opening at <span style={{ fontWeight: 700 }}>{state.courseName}</span> on {state.dateTime}.
                    </span>
                </div>
            </div>

            <div style={{ position: 'absolute', bottom: 120, left: 40, right: 40, textAlign: 'center', zIndex: 10 }}>
                <p style={{
                    fontSize: 48,
                    fontWeight: 600,
                    color: 'rgba(255,255,255,0.9)',
                    textShadow: '0 4px 16px rgba(0,0,0,0.8)'
                }}>
                    {state.customText2 || "Link in bio to download"}
                </p>
            </div>
        </div>
    );
};
