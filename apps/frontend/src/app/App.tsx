import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Route, Routes } from 'react-router-dom';
import { getHealth } from '../services/health';

function FoundationPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: getHealth,
    retry: false,
  });

  const apiState = health.isSuccess ? 'API disponível' : 'API aguardando conexão';

  return (
    <main className="app-shell">
      <motion.section
        className="foundation-card"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <span className="eyebrow">LECCOR FINANCE FLOW</span>
        <h1>A fundação do seu assistente financeiro está pronta.</h1>
        <p>
          Frontend React e API NestJS compartilham uma base TypeScript estrita, testável e
          preparada para evoluir por etapas.
        </p>
        <div className="status-row" aria-live="polite">
          <span
            className={health.isSuccess ? 'status-dot status-dot--online' : 'status-dot'}
            aria-hidden="true"
          />
          {apiState}
        </div>
      </motion.section>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<FoundationPage />} />
    </Routes>
  );
}
