import { useState } from 'react';
import './index.css';
import Topbar from './components/Topbar';
import Dashboard from './components/Dashboard';
import Forecast from './components/Forecast';
import Deficit from './components/Deficit';
import Profit from './components/Profit';
import Cycle from './components/Cycle';
import AIAdvisor from './components/AIAdvisor';

const TABS = [
  { id: 'dashboard', label: 'Обзор' },
  { id: 'forecast',  label: 'Прогноз' },
  { id: 'deficit',   label: 'Индексы' },
  { id: 'profit',    label: 'Прибыльность' },
  { id: 'cycle',     label: 'Цикл рынка' },
  { id: 'ai',        label: 'AI-советник' },
];

export default function App() {
  const [tab, setTab] = useState('dashboard');

  function renderTab() {
    switch (tab) {
      case 'dashboard': return <Dashboard />;
      case 'forecast':  return <Forecast />;
      case 'deficit':   return <Deficit />;
      case 'profit':    return <Profit />;
      case 'cycle':     return <Cycle />;
      case 'ai':        return <AIAdvisor />;
      default:          return <Dashboard />;
    }
  }

  return (
    <div className="app">
      <Topbar />
      <nav className="nav" role="navigation" aria-label="Platform sections">
        {TABS.map(t => (
          <div
            key={t.id}
            className={`nav-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && setTab(t.id)}
          >
            {t.label}
          </div>
        ))}
      </nav>
      <main className="main">
        {renderTab()}
      </main>
    </div>
  );
}
