import React from 'react';
import type { GlobalState } from '../types';

export const Nostalgia: React.FC<{ state: GlobalState }> = ({ state }) => {
    return (
        <div
            style={{
                width: 1080,
                height: 1920,
                backgroundColor: '#ece9d8', // Old Windows beige
                color: '#000',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '120px 80px',
                fontFamily: '"Trebuchet MS", "Lucida Sans Unicode", sans-serif',
                position: 'relative'
            }}
        >
            <div style={{ textAlign: 'center', marginBottom: 120 }}>
                <h2 style={{ fontSize: 64, fontWeight: 700, color: '#333', marginBottom: 32 }}>
                    {state.customText1 || "Remember trying to find a tee time in 2005?"}
                </h2>
                <p style={{ fontSize: 40, color: '#666' }}>{state.customText2 || "Calling the pro shop 14 times..."}</p>
            </div>

            {/* Classic Windows XP Style Error Box */}
            <div style={{
                width: '100%',
                backgroundColor: '#fff',
                border: '4px outset #fff',
                boxShadow: '4px 4px 0 rgba(0,0,0,0.5)',
                marginBottom: 160
            }}>
                {/* Title Bar */}
                <div style={{
                    backgroundColor: '#0055e5',
                    background: 'linear-gradient(180deg, #0050d0 0%, #0030a0 100%)',
                    padding: '16px 24px',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: 32,
                    display: 'flex',
                    justifyContent: 'space-between'
                }}>
                    <span>Pro Shop.exe</span>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <div style={{ width: 36, height: 36, backgroundColor: '#fff', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000' }}>_</div>
                        <div style={{ width: 36, height: 36, backgroundColor: '#fff', borderRadius: 4 }} />
                        <div style={{ width: 36, height: 36, backgroundColor: '#e51400', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>X</div>
                    </div>
                </div>

                {/* Box Content */}
                <div style={{ padding: 60, display: 'flex', alignItems: 'center', gap: 40 }}>
                    <div style={{ width: 120, height: 120, borderRadius: 60, backgroundColor: '#e51400', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 80, fontWeight: 'bold' }}>X</div>
                    <div style={{ fontSize: 48, color: '#000' }}>
                        No tee times available for<br /><b>{state.courseName}</b>.
                    </div>
                </div>
                <div style={{ padding: '0 60px 60px', display: 'flex', justifyContent: 'center' }}>
                    <div style={{ padding: '24px 80px', border: '4px outset #fff', backgroundColor: '#e0e0e0', fontSize: 36 }}>OK</div>
                </div>
            </div>

            <div style={{ textAlign: 'center' }}>
                <h2 style={{ fontSize: 72, fontWeight: 800, color: '#10b981', marginBottom: 20 }}>
                    {state.customText3 || "Welcome to 2026."}
                </h2>
                <p style={{ fontSize: 48, color: '#333', fontWeight: 600 }}>
                    {state.customText4 || "TeeSignal found it for you."}
                </p>
            </div>

            <div style={{
                marginTop: 80,
                backgroundColor: '#fff',
                padding: 40,
                borderRadius: 24,
                boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
                textAlign: 'center',
                width: '100%'
            }}>
                <div style={{ fontSize: 32, color: '#666', marginBottom: 12 }}>{state.customText5 || "Automatically Secured:"}</div>
                <div style={{ fontSize: 48, fontWeight: 'bold', color: '#000' }}>{state.courseName}</div>
                <div style={{ fontSize: 36, color: '#10b981', fontWeight: 600, marginTop: 12 }}>{state.dateTime}</div>
            </div>

        </div>
    );
};
