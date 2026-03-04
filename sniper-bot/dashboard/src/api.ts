import axios from 'axios';

// In Vite dev mode, use localhost. In production Docker, use the replaced value.
// We use a specific string placeholder "API_URL_PLACEHOLDER" that the entrypoint script will replace.
const injectedApiUrl = "API_URL_PLACEHOLDER";
// Avoid lint err by casting or simply checking if it starts with API_URL
const API_BASE = import.meta.env.DEV ? 'http://localhost:3000/api' :
    (injectedApiUrl.startsWith('API_URL_') ? '/api' : injectedApiUrl);

export const api = {
    getStatus: () => axios.get(`${API_BASE}/status`).then(res => res.data),
    getBalance: () => axios.get(`${API_BASE}/balance`).then(res => res.data),
    getPnl: () => axios.get(`${API_BASE}/pnl`).then(res => res.data),
    getChartBalance: () => axios.get(`${API_BASE}/chart/balance`).then(res => res.data),
    getActivePositions: () => axios.get(`${API_BASE}/positions/active`).then(res => res.data),
    getHistory: () => axios.get(`${API_BASE}/positions/history`).then(res => res.data),
};
