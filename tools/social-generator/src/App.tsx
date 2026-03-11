import React, { useState } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { defaultState } from './types';
import type { GlobalState } from './types';

function App() {
  const [state, setState] = useState<GlobalState>(defaultState);

  return (
    <div className="app-container">
      <Sidebar state={state} setState={setState} />
      <Canvas state={state} />
    </div>
  );
}

export default App;
