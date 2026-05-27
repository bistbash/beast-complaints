import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  validateStatus: (status) => status < 500 || status === 401 || status === 403,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('beast_sso_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    if (error.response?.status === 401 || error.response?.status === 403) {
      if (!url.includes('/auth/validate') && !url.includes('/auth/slo/')) {
        window.dispatchEvent(new CustomEvent('sso:unauthorized'));
      }
    }
    return Promise.reject(error);
  },
);

export default api;
