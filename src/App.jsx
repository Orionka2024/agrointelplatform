import { Component, useState } from 'react';
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

class TabErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="panel" role="alert" style={{ padding: 16 }}>
          <div className="signal-box sell">
            <div className="signal-label sell">Ошибка отображения раздела</div>
            <div className="signal-text sell">{this.state.error?.message || 'Неизвестная ошибка'}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      case 'forecast':    return <Forecast onNavigateToImport={() => setTab('data_import')} onNavigateToDashboard={() => setTab('dashboard')} />;
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
        <TabErrorBoundary key={tab}>
          {renderTab()}
        </TabErrorBoundary>
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
