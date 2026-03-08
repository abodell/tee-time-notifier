import React from 'react';
import type { GlobalState } from '../types';
// We will build these template components next!
import { SneakerDrop } from '../templates/SneakerDrop';
import { Aspirational } from '../templates/Aspirational';
import { Sniper } from '../templates/Sniper';
import { Nostalgia } from '../templates/Nostalgia';
import { Meme } from '../templates/Meme';

interface Props {
    state: GlobalState;
}

export const TemplateRenderer: React.FC<Props> = ({ state }) => {
    switch (state.templateId) {
        case 'sneaker':
            return <SneakerDrop state={state} />;
        case 'aspirational':
            return <Aspirational state={state} />;
        case 'sniper':
            return <Sniper state={state} />;
        case 'nostalgia':
            return <Nostalgia state={state} />;
        case 'meme':
            return <Meme state={state} />;
        default:
            return null;
    }
};
