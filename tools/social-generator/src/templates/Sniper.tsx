import React from 'react';
import type { GlobalState } from '../types';

export const Sniper: React.FC<{ state: GlobalState }> = ({ state }) => {
    return (
        <div
            style={{
                width: 1080,
                height: 1920,
                backgroundColor: '#0f172a',
                color: '#fff',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '120px 0',
                fontFamily: 'Inter, sans-serif'
            }}
        >
            <div style={{ width: 900 }}>
                <div style={{ marginBottom: 120, textAlign: 'center' }}>
                    <h2 style={{ fontSize: 72, fontWeight: 800, color: '#10b981', marginBottom: 32, letterSpacing: '0.05em' }}>
                        {state.customText1 || "THE CATCH"}
                    </h2>
                    <h1 style={{ fontSize: 100, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', color: '#f8fafc' }}>
                        {state.courseName}
                    </h1>
                </div>

                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 80,
                    borderLeft: '6px solid #334155',
                    paddingLeft: 80,
                    position: 'relative',
                    marginLeft: 40 // offset the left boundary so content stays mostly centered
                }}>

                    <div style={{ position: 'relative' }}>
                        <div style={{
                            position: 'absolute', left: -99, top: 12,
                            width: 32, height: 32, borderRadius: 16, backgroundColor: '#ef4444',
                            border: '6px solid #0f172a'
                        }} />
                        <div style={{ fontSize: 48, color: '#ef4444', fontWeight: 700, marginBottom: 16 }}>
                            Yesterday 8:02 PM
                        </div>
                        <div style={{ fontSize: 60, fontWeight: 600, color: '#cbd5e1' }}>
                            {state.customText2 || "Someone cancels."}
                        </div>
                    </div>

                    <div style={{ position: 'relative' }}>
                        <div style={{
                            position: 'absolute', left: -99, top: 12,
                            width: 32, height: 32, borderRadius: 16, backgroundColor: '#10b981',
                            border: '6px solid #0f172a',
                            boxShadow: '0 0 24px rgba(16, 185, 129, 0.6)'
                        }} />
                        <div style={{ fontSize: 48, color: '#10b981', fontWeight: 700, marginBottom: 16 }}>
                            Yesterday 8:03 PM
                        </div>
                        <div style={{ fontSize: 60, fontWeight: 600, color: '#f8fafc' }}>
                            {state.customText3 || "TeeSignal catches it instantly."}
                        </div>
                    </div>

                </div>

                <div style={{
                    marginTop: 140,
                    backgroundColor: '#1e293b',
                    borderRadius: 40,
                    padding: 80,
                    border: '2px solid #334155',
                    textAlign: 'center',
                    boxShadow: '0 40px 80px rgba(0,0,0,0.5)'
                }}>
                    <div style={{ fontSize: 36, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 24, fontWeight: 600 }}>
                        {state.customText4 || "Secured Time"}
                    </div>
                    <div style={{ fontSize: 64, fontWeight: 700, color: '#fff', marginBottom: 40 }}>
                        {state.dateTime}
                    </div>
                    <div style={{ display: 'flex', gap: 60, justifyContent: 'center' }}>
                        <div style={{ fontSize: 48, color: '#cbd5e1' }}>{state.holes} Holes</div>
                        <div style={{ fontSize: 48, color: '#10b981', fontWeight: 700 }}>{state.price}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};
