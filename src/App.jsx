import { useState } from 'react';
import './index.css';
import { MarketProvider } from './context/MarketContext';
import Topbar from './components/Topbar';
import Dashboard from './components/Dashboard';
import Forecast from './components/Forecast';
import Deficit from './components/Deficit';
import Profit from './components/Profit';
import Cycle from './components/Cycle';
import DataImport from './components/DataImport';
import AIAdvisor from './components/AIAdvisor';

const TABS = [
  { id: 'dashboard',   label: 'Обзор' },
  { id: 'forecast',    label: 'Прогноз цен' },
  { id: 'deficit',     label: 'Баланс и дефицит' },
  { id: 'profit',      label: 'Экономика хранения' },
  { id: 'cycle',       label: 'Планирование 2027/28' },
  { id: 'data_import', label: 'Импорт данных (CSV)' },
  { id: 'ai',          label: 'AI-советник' },
];

function AppContent() {
  const [tab, setTab] = useState('dashboard');

  function renderTab() {
    switch (tab) {
      case 'dashboard':   return <Dashboard />;
      case 'forecast':    return <Forecast onNavigateToImport={() => setTab('data_import')} />;
      case 'deficit':     return <Deficit />;
      case 'profit':      return <Profit />;
      case 'cycle':       return <Cycle />;
      case 'data_import': return <DataImport />;
      case 'ai':          return <AIAdvisor />;
      default:            return <Dashboard />;
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

export default function App() {
  return (
    <MarketProvider>
      <AppContent />
    </MarketProvider>
  );
}
