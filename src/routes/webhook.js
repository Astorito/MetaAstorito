const express = require('express');
const router = express.Router();
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { handleWeatherQuery } = require('../services/weather');
const { parseReminderWithOpenAI, getGPTResponse } = require('../services/openai');
const Reminder = require('../models/reminder');
const { DateTime } = require('luxon');
const { findBestEmoji } = require('../utils/emoji');

function isWeatherQuery(text) {
  return /(clima|tiempo|temperatura|lluvia|pronóstico|pronostico)/i.test(text);
}

function isGreeting(text) {
  return /^(hola|buenas|buen día|buenas tardes|buenas noches)$/i.test(text.trim());
}

// Set para recordar usuarios que ya recibieron respuesta de OpenAI
const alreadyAnswered = new Set();

router.post("/", async (req, res) => {
  const messageText = req.body?.text;
  const from = req.body?.from;

  if (!messageText || !from) {
    return res.sendStatus(200);
  }

  // 1. Si es clima, responde clima y termina
  if (isWeatherQuery(messageText)) {
    await handleWeatherQuery(messageText, from);
    return res.sendStatus(200);
  }

  // 2. Si es un saludo, responde saludo y termina
  if (isGreeting(messageText)) {
    await sendWhatsAppMessage(from, "Hola! En qué puedo ayudarte hoy?");
    return res.sendStatus(200);
  }

  // 3. Si no, intenta parsear como recordatorio
  try {
    const parsed = await parseReminderWithOpenAI(messageText);

    if (parsed.type === "reminder") {
      // Validar datos
      if (!parsed.data.date || !parsed.data.time) {
        await sendWhatsAppMessage(from, "Faltan datos para crear el recordatorio (fecha y hora). ¿Podés especificarlos?");
        return res.sendStatus(200);
      }

      // Crear y guardar el recordatorio (usa Luxon para fechas)
      const eventDate = DateTime.fromISO(`${parsed.data.date}T${parsed.data.time}`);
      if (!eventDate.isValid) {
        await sendWhatsAppMessage(from, "La fecha y hora del recordatorio no son válidas. Por favor, revisá el mensaje.");
        return res.sendStatus(200);
      }

      // Calcula notifyAt según el campo "notify"
      let notifyAt = eventDate;
      if (parsed.data.notify?.includes('hora')) {
        const horas = parseInt(parsed.data.notify);
        notifyAt = eventDate.minus({ hours: horas });
      } else if (parsed.data.notify?.includes('minuto')) {
        const minutos = parseInt(parsed.data.notify);
        notifyAt = eventDate.minus({ minutes: minutos });
      }

      const reminder = new Reminder({
        phone: from,
        title: parsed.data.title,
        emoji: findBestEmoji(parsed.data.title),
        date: eventDate.toJSDate(),
        notifyAt: notifyAt.toJSDate(),
        sent: false
      });

      await reminder.save();

      const confirmMessage =
        `✅ Recordatorio creado!\n\n` +
        `${reminder.emoji} *${reminder.title}*\n` +
        `📅 Fecha: ${eventDate.toFormat("EEEE d 'de' MMMM", { locale: 'es' })} a las ${eventDate.toFormat('HH:mm')}\n` +
        `⏰ Te avisaré: ${notifyAt.toFormat("EEEE d 'de' MMMM", { locale: 'es' })} a las ${notifyAt.toFormat('HH:mm')}\n\n` +
        `Avisanos si querés agendar otro evento!`;

      await sendWhatsAppMessage(from, confirmMessage);
      return res.sendStatus(200);
    } else {
      // Si no es reminder, responde con OpenAI solo la primera vez
      if (!alreadyAnswered.has(from)) {
        const gpt = await getGPTResponse(messageText);
        let respuesta = gpt.content;
        if (respuesta.endsWith('.')) respuesta = respuesta.slice(0, -1);
        respuesta += "\n\nPara otras consultas entra a https://chatgpt.com/";
        await sendWhatsAppMessage(from, respuesta);
        alreadyAnswered.add(from);
      } else {
        await sendWhatsAppMessage(from, "Hola!\nPara esas consultas te recomiendo entrar a : https://chatgpt.com/\nNos vemos!");
      }
      return res.sendStatus(200);
    }
  } catch (err) {
    await sendWhatsAppMessage(from, "Ocurrió un error procesando tu mensaje.");
    return res.sendStatus(200);
  }
});

module.exports = router;