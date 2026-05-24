import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import './index.css'
import App from './App.jsx'
import CardLab from './preview/CardLab.jsx'
import AnaloguesLab from './preview/AnaloguesLab.jsx'
import PlanLab from './preview/PlanLab.jsx'
import Deck from './presentation/Deck.jsx'
import BrewLoader from './components/BrewLoader.jsx'

const lab = new URLSearchParams(location.search).get('lab');
const deck = new URLSearchParams(location.search).get('deck');

const LoaderLab = () => (
  <div style={{ minHeight: '100vh', background: '#0a0e1a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
    <BrewLoader />
  </div>
);

const labRoutes = { card: <CardLab />, analogues: <AnaloguesLab />, plan: <PlanLab />, loader: <LoaderLab /> };

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {deck === '1' ? <Deck /> : labRoutes[lab] ?? <App />}
  </StrictMode>,
)
