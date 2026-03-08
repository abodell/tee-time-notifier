import React from 'react';
import type { GlobalState } from '../types';
import { Upload, Image as ImageIcon } from 'lucide-react';

interface SidebarProps {
    state: GlobalState;
    setState: React.Dispatch<React.SetStateAction<GlobalState>>;
}

export const Sidebar: React.FC<SidebarProps> = ({ state, setState }) => {
    const [imageUrl, setImageUrl] = React.useState<string>(state.backgroundImage);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setImageUrl(url);
            setState(prev => ({ ...prev, backgroundImage: url }));
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setState(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div className="sidebar">
            <div className="sidebar-content">
                <div style={{ marginBottom: '2rem' }}>
                    <h2 style={{ fontSize: '1.25rem', color: 'var(--primary-color)' }}>TeeSignal Studio</h2>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Social Post Generator v2.0</p>
                </div>

                <div className="form-group">
                    <label className="form-label">Template Style</label>
                    <select
                        name="templateId"
                        value={state.templateId}
                        onChange={handleChange}
                        className="form-input"
                        style={{ backgroundColor: 'var(--surface-color-hover)' }}
                    >
                        <option value="sneaker">1. Sneaker Drop (1080x1920)</option>
                        <option value="aspirational">2. Aspirational Notification (1080x1920)</option>
                        <option value="sniper">3. The Sniper (1080x1920)</option>
                        <option value="nostalgia">4. Nostalgia 2005 (1080x1920)</option>
                        <option value="meme">5. The Meme (1080x1920)</option>
                    </select>
                </div>

                <div className="form-group">
                    <label className="form-label">Course Name</label>
                    <input
                        type="text"
                        name="courseName"
                        value={state.courseName}
                        onChange={handleChange}
                        className="form-input"
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Date & Time</label>
                    <input
                        type="text"
                        name="dateTime"
                        value={state.dateTime}
                        onChange={handleChange}
                        className="form-input"
                    />
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">Holes</label>
                        <input
                            type="number"
                            name="holes"
                            value={state.holes}
                            onChange={handleChange}
                            className="form-input"
                        />
                    </div>
                    <div className="form-group" style={{ flex: 1 }}>
                        <label className="form-label">Price</label>
                        <input
                            type="text"
                            name="price"
                            value={state.price}
                            onChange={handleChange}
                            className="form-input"
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Background Image</label>
                    <div
                        style={{
                            border: '2px dashed var(--border-color)',
                            borderRadius: '0.5rem',
                            padding: '1rem',
                            textAlign: 'center',
                            position: 'relative',
                            cursor: 'pointer',
                            marginBottom: '0.5rem',
                            backgroundColor: imageUrl ? 'transparent' : 'var(--bg-color)',
                            backgroundImage: imageUrl ? `url(${imageUrl})` : 'none',
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                            minHeight: '120px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden'
                        }}
                    >
                        {imageUrl && <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} />}
                        <div style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
                            {imageUrl ? (
                                <div style={{ color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <ImageIcon size={24} style={{ marginBottom: '0.5rem' }} />
                                    <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>Replace Image</span>
                                </div>
                            ) : (
                                <div style={{ color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <Upload size={24} style={{ marginBottom: '0.5rem' }} />
                                    <span style={{ fontSize: '0.875rem' }}>Click to Upload</span>
                                </div>
                            )}
                        </div>
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', zIndex: 2 }}
                        />
                    </div>
                </div>

                <div className="form-group">
                    <label className="form-label">Custom Text 1 (Header/Meme Text)</label>
                    <input
                        type="text"
                        name="customText1"
                        value={state.customText1 || ''}
                        onChange={handleChange}
                        placeholder="e.g. Did anyone find a time yet?"
                        className="form-input"
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Custom Text 2 (Subtext)</label>
                    <input
                        type="text"
                        name="customText2"
                        value={state.customText2 || ''}
                        onChange={handleChange}
                        placeholder="Optional subtext..."
                        className="form-input"
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Custom Text 3</label>
                    <input
                        type="text"
                        name="customText3"
                        value={state.customText3 || ''}
                        onChange={handleChange}
                        placeholder="Optional text..."
                        className="form-input"
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Custom Text 4</label>
                    <input
                        type="text"
                        name="customText4"
                        value={state.customText4 || ''}
                        onChange={handleChange}
                        placeholder="Optional text..."
                        className="form-input"
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Custom Text 5</label>
                    <input
                        type="text"
                        name="customText5"
                        value={state.customText5 || ''}
                        onChange={handleChange}
                        placeholder="Optional text..."
                        className="form-input"
                    />
                </div>

            </div>
        </div>
    );
};
