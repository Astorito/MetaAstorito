const express = require('express');
const { connectDB } = require('./src/config/database');
const webhookRoutes = require('./src/routes/webhook');
const { startScheduler } = require('./src/services/scheduler'); // <-- Agrega esto

const app = express();
app.use(express.json()); // <--- Esto es fundamental

// Conectar a MongoDB
connectDB();

// Iniciar el scheduler
startScheduler(); // <-- Agrega esto

// Rutas
app.use('/', webhookRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});