import React from 'react';
import type { GlobalState } from '../types';

export const SneakerDrop: React.FC<{ state: GlobalState }> = ({ state }) => {
    return (
        <div
            style={{
                width: 1080,
                height: 1920,
                backgroundColor: '#000',
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '120px 80px',
                position: 'relative',
                textAlign: 'center'
            }}
        >
            {state.backgroundImage && (
                <>
                    <div
                        style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundImage: `url(${state.backgroundImage})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            opacity: 0.4,
                            filter: 'grayscale(100%) blur(4px)'
                        }}
                    />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%)' }} />
                </>
            )}

            <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 900, margin: '0 auto' }}>
                <div style={{
                    display: 'inline-block',
                    backgroundColor: '#ef4444',
                    color: 'white',
                    padding: '16px 40px',
                    borderRadius: 100,
                    fontWeight: 800,
                    fontSize: 36,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    marginBottom: 60,
                    fontFamily: 'Outfit, sans-serif'
                }}>
                    {state.customText2 || "🚨 DROP ALERT"}
                </div>

                <h1 style={{
                    fontSize: 120,
                    fontWeight: 800,
                    lineHeight: 1.1,
                    marginBottom: 60,
                    fontFamily: 'Outfit, sans-serif',
                    letterSpacing: '-0.02em',
                    textShadow: '0 10px 30px rgba(0,0,0,0.5)'
                }}>
                    {state.courseName.toUpperCase()}
                </h1>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 32, marginBottom: 100, alignItems: 'center' }}>
                    <div style={{ fontSize: 56, fontWeight: 500, color: '#e2e8f0', letterSpacing: '-0.01em' }}>
                        <span style={{ color: '#ef4444', fontWeight: 800, marginRight: 24 }}>DATE</span>
                        {state.dateTime}
                    </div>
                    <div style={{ display: 'flex', gap: 80, justifyContent: 'center' }}>
                        <div style={{ fontSize: 56, fontWeight: 500, color: '#e2e8f0' }}>
                            <span style={{ color: '#ef4444', fontWeight: 800, marginRight: 24 }}>HOLES</span>
                            {state.holes}
                        </div>
                        <div style={{ fontSize: 56, fontWeight: 500, color: '#e2e8f0' }}>
                            <span style={{ color: '#ef4444', fontWeight: 800, marginRight: 24 }}>PRICE</span>
                            {state.price}
                        </div>
                    </div>
                </div>

                <div style={{
                    fontSize: 44,
                    color: '#cbd5e1',
                    fontWeight: 500,
                    fontStyle: 'italic'
                }}>
                    {state.customText1 || "Just caught on TeeSignal. Link in bio."}
                </div>
            </div>

            <div style={{
                position: 'absolute',
                bottom: 120,
                left: 0,
                right: 0,
                textAlign: 'center',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 24
            }}>
                <img src="/icon.png" style={{ width: 80, height: 80, borderRadius: 20, backgroundColor: '#fff' }} />
                <span style={{ fontSize: 56, fontWeight: 700, fontFamily: 'Outfit, sans-serif', letterSpacing: '-0.02em' }}>
                    TeeSignal <span style={{ color: '#94a3b8' }}>App</span>
                </span>
            </div>
        </div>
    );
};
