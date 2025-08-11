// Importar dependencias 
const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const dateparser = require('dateparser');
require('dotenv').config();

const app = express();
app.use(express.json());

// Variables de entorno
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGO_URI;

// Conexión a MongoDB
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Conectado a MongoDB"))
  .catch(err => console.error("❌ Error conectando a MongoDB", err));

// Modelo de evento
const Event = mongoose.model('Event', new mongoose.Schema({
  title: String,
  date: Date,
  avisoDate: Date
}));

// Función para formatear fecha y hora en formato "dd/mm/yyyy a las hh:mm AM/PM"
function formatDateTime(date) {
  return `${date.toLocaleDateString('es-AR')} a las ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
}

// Función para asignar emoji según evento
function getEmojiForEvent(title) {
  const lower = title.toLowerCase();
  if (lower.includes('peluquer')) return '✂️';
  if (lower.includes('cumple')) return '🎂';
  if (lower.includes('medico') || lower.includes('doctor')) return '🩺';
  return '📝';
}

// Función para parsear fecha/hora desde texto del usuario
function parseEventFromText(userText) {
  let fechaEvento = dateparser.parse(userText, {
    languages: ['es'],
    settings: {
      PREFER_DATES_FROM: 'future',
      RELATIVE_BASE: new Date()
    }
  });

  // Ajuste si menciona "mañana" explícitamente
  if (userText.toLowerCase().includes('mañana')) {
    const hoy = new Date();
    fechaEvento = new Date(hoy);
    fechaEvento.setDate(hoy.getDate() + 1);
  }

  // Ajuste si menciona hora explícita
  const matchHora = userText.match(/(\d{1,2})\s*(am|pm|de la mañana|de la tarde)?/i);
  if (matchHora && fechaEvento) {
    let hora = parseInt(matchHora[1], 10);
    let meridiano = matchHora[2]?.toLowerCase();

    if (meridiano && (meridiano.includes('pm') || meridiano.includes('tarde')) && hora < 12) {
      hora += 12;
    }
    if (meridiano && (meridiano.includes('am') || meridiano.includes('mañana')) && hora === 12) {
      hora = 0;
    }

    fechaEvento.setHours(hora, 0, 0, 0);
  }

  // Detectar horas de aviso antes del evento
  let avisoHoras = 0;
  const matchAviso = userText.match(/(\d+)\s*hora/);
  if (matchAviso) {
    avisoHoras = parseInt(matchAviso[1], 10);
  }

  return { fechaEvento, avisoHoras };
}

// Función para construir mensaje final
function buildEventMessage(eventTitle, eventDate, avisoHorasAntes) {
  const emoji = getEmojiForEvent(eventTitle);
  const avisoDate = new Date(eventDate);
  avisoDate.setHours(avisoDate.getHours() - avisoHorasAntes);

  return `Genial! Ya agendamos tu evento 🚀

${emoji} ${eventTitle}
🗓️ Fecha: ${formatDateTime(eventDate)}
⌛ Aviso: ${formatDateTime(avisoDate)}

Avisanos si necesitás que agendemos otro evento!`;
}

// Endpoint para recibir mensajes de WhatsApp
app.post('/webhook', async (req, res) => {
  const userText = req.body.message;
  const eventTitle = "Peluquería"; // Acá podrías detectar intención real

  const { fechaEvento, avisoHoras } = parseEventFromText(userText);

  // Guardar en base de datos
  await Event.create({
    title: eventTitle,
    date: fechaEvento,
    avisoDate: new Date(fechaEvento.getTime() - (avisoHoras * 60 * 60 * 1000))
  });

  // Responder al usuario
  const respuesta = buildEventMessage(eventTitle, fechaEvento, avisoHoras || 0);

  // Ejemplo de envío con WhatsApp Cloud API
  await axios.post(`https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`, {
    messaging_product: "whatsapp",
    to: req.body.from,
    text: { body: respuesta }
  }, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });

  res.sendStatus(200);
});

app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en puerto ${port}`);
});
