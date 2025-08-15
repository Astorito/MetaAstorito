const express = require('express');
const { connectDB } = require('./src/config/database');
const { port } = require('./src/config/environment');
const webhookRoutes = require('./src/routes/webhook');
const { startScheduler } = require('./src/services/scheduler'); // <-- Agrega esto

const app = express();
app.use(express.json());

// Conectar a MongoDB
connectDB();

// Iniciar el scheduler
startScheduler(); // <-- Agrega esto

// Rutas
app.use('/', webhookRoutes);

app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});