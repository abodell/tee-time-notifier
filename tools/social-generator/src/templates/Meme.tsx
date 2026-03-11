import React from 'react';
import type { GlobalState } from '../types';

export const Meme: React.FC<{ state: GlobalState }> = ({ state }) => {
    return (
        <div
            style={{
                width: 1080,
                height: 1920,
                backgroundColor: '#0b1120',
                backgroundImage: 'radial-gradient(#1e293b 3px, transparent 3px)',
                backgroundSize: '48px 48px',
                backgroundPosition: '-24px -24px',
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center', // Centers the 900px column
                fontFamily: 'Inter, sans-serif'
            }}
        >
            <div style={{ width: 900, height: '100%', display: 'flex', flexDirection: 'column' }}>
                {/* Top Half: Pain Point (iMessage fake out) */}
                <div style={{ height: 1000, backgroundColor: '#f9fafb', position: 'relative', overflow: 'hidden' }}>
                    {/* Fake Header */}
                    <div style={{ backgroundColor: '#fff', padding: '60px 40px 40px', textAlign: 'center', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
                        <div style={{ fontSize: 44, fontWeight: 700, color: '#000' }}>The Boys ⛳️</div>
                        <div style={{ fontSize: 36, color: '#6b7280', marginTop: 12 }}>4 People</div>
                    </div>

                    {/* Fake Messages */}
                    <div style={{ padding: '200px 60px 40px', display: 'flex', flexDirection: 'column', gap: 32 }}>

                        <div style={{ alignSelf: 'center', width: '100%' }}>
                            <div style={{ backgroundColor: '#e5e7eb', color: '#000', padding: '40px 48px', borderRadius: '32px', fontSize: 48, lineHeight: 1.4, textAlign: 'center' }}>
                                {state.customText1 || "Anyone find a tee time for Saturday yet? Everything is booked up."}
                            </div>
                        </div>

                        <div style={{ alignSelf: 'center', width: '100%' }}>
                            <div style={{ backgroundColor: '#e5e7eb', color: '#000', padding: '40px 48px', borderRadius: '32px', fontSize: 48, lineHeight: 1.4, textAlign: 'center' }}>
                                {state.customText2 || "I've literally been refreshing ForeUp for an hour."}
                            </div>
                        </div>

                        <div style={{ alignSelf: 'flex-end', maxWidth: '90%' }}>
                            <div style={{ backgroundColor: '#3b82f6', color: '#fff', padding: '32px 48px', borderRadius: '48px 48px 12px 48px', fontSize: 48, lineHeight: 1.4 }}>
                                {state.customText3 || "Don't worry, boys. I got us."}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Half: Solution (The App) */}
                <div style={{ flex: 1, padding: '80px 0', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <h2 style={{ fontSize: 56, fontWeight: 800, color: '#f8fafc', marginBottom: 60, textAlign: 'center', letterSpacing: '-0.02em', textShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                        {state.customText4 || "Meanwhile, you on TeeSignal..."}
                    </h2>

                    <div style={{
                        backgroundColor: '#1e293b',
                        borderRadius: 32,
                        padding: 50,
                        border: '2px solid #334155',
                        boxShadow: '0 40px 80px rgba(0,0,0,0.5)'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
                            <div style={{ fontSize: 44, fontWeight: 700, color: '#f8fafc' }}>{state.courseName}</div>
                            {/* Fake iOS Toggle Active */}
                            <div style={{ width: 110, height: 64, backgroundColor: '#10b981', borderRadius: 32, position: 'relative' }}>
                                <div style={{ width: 56, height: 56, backgroundColor: '#fff', borderRadius: 28, position: 'absolute', top: 4, right: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }} />
                            </div>
                        </div>

                        <div style={{ fontSize: 36, color: '#94a3b8', marginBottom: 24, textAlign: 'center' }}>
                            {state.customText5 || "Tracking openings around"} <span style={{ color: '#f8fafc', fontWeight: 700 }}>{state.dateTime}</span>
                        </div>

                        <div style={{ fontSize: 36, color: '#94a3b8', textAlign: 'center' }}>
                            <span style={{ color: '#f8fafc', fontWeight: 700 }}>{state.holes}</span> Holes
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
