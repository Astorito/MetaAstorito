const express = require('express');
const { connectDB } = require('./src/config/database');
const webhookRoutes = require('./src/routes/webhook');
const { startScheduler } = require('./src/services/scheduler');
const { startListCleanerScheduler } = require('./src/services/listCleaner');

const app = express();
app.use(express.json());

// Conectar a MongoDB
connectDB();

// Iniciar el scheduler
startScheduler();

// Iniciar scheduler para limpiar listas antiguas
startListCleanerScheduler();

// Rutas
app.use('/', webhookRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});