import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import CardLab from './preview/CardLab.jsx'
import AnaloguesLab from './preview/AnaloguesLab.jsx'
import Deck from './presentation/Deck.jsx'

const lab = new URLSearchParams(location.search).get('lab');
const deck = new URLSearchParams(location.search).get('deck');

const labRoutes = { card: <CardLab />, analogues: <AnaloguesLab /> };

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {deck === '1' ? <Deck /> : labRoutes[lab] ?? <App />}
  </StrictMode>,
)
