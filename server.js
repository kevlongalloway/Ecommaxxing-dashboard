const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/config', (_req, res) => {
  const workerUrl = process.env.WORKER_URL;
  if (!workerUrl) {
    return res.status(500).json({ error: 'WORKER_URL environment variable is not set' });
  }
  res.json({ workerUrl: workerUrl.replace(/\/$/, '') });
});

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Ecommaxxing Admin Dashboard running on port ${PORT}`);
});
