const express = require('express');
const router = express.Router();
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { handleWeatherQuery } = require('../services/weather');
const { parseReminderWithOpenAI, getGPTResponse } = require('../services/openai');
const Reminder = require('../models/reminder');
const { DateTime } = require('luxon');
const { findBestEmoji } = require('../utils/emoji');
const { handleAudioMessage } = require('../services/transcription');

function isWeatherQuery(text) {
  // Amplié la lista de palabras para detectar consultas de clima
  return /(clima|tiempo|temperatura|lluvia|pronóstico|pronostico|llover|lloviendo|soleado|sol|nublado)/i.test(text);
}

function isGreeting(text) {
  return /^(hola|buenas|buen día|buenas tardes|buenas noches)$/i.test(text.trim());
}

// Set para recordar usuarios que ya recibieron respuesta de OpenAI
const alreadyAnswered = new Set();
// Set para recordar usuarios esperando ciudad para clima
const waitingForCity = new Set();

router.post("/", async (req, res) => {
  // Log completo para debug
  console.log("🔔 Webhook recibido (raw body):", JSON.stringify(req.body, null, 2));

  // Extraer datos de la estructura de WhatsApp
  let from, messageText, messageType, audioId;
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    
    if (message) {
      from = message.from;
      messageType = message.type;
      
      // Extraer texto o audio según el tipo
      if (messageType === 'text') {
        messageText = message.text?.body;
      } else if (messageType === 'audio' && message.audio) {
        audioId = message.audio.id;
        console.log("🎤 Audio ID detectado:", audioId);
      }
    }
  } catch (e) {
    console.error('Error extrayendo datos del mensaje:', e);
  }

  console.log("🔔 Webhook procesando:", { from, messageType, audioId });

  if (!from) {
    console.log("❌ Mensaje sin remitente");
    return res.sendStatus(200);
  }

  // MANEJAR AUDIO: si es un mensaje de audio, procesarlo
  if (messageType === 'audio' && audioId) {
    console.log("🎤 Procesando mensaje de audio, ID:", audioId);
    const token = process.env.WHATSAPP_TOKEN;
    
    // Procesar el audio y obtener la transcripción
    messageText = await handleAudioMessage(audioId, from, token);
    
    // Si no obtuvimos transcripción, terminamos
    if (!messageText) {
      return res.sendStatus(200);
    }
    
    console.log("🎤 Audio procesado como comando:", messageText);
    // Continúa con el flujo normal usando la transcripción como mensaje
  }

  // Verificar que tenemos texto para procesar (ya sea de texto o transcrito)
  if (!messageText) {
    console.log("❌ No hay texto para procesar");
    return res.sendStatus(200);
  }

  // Si el usuario estaba esperando ciudad para clima, procesar directamente
  if (waitingForCity.has(from)) {
    console.log("🌆 Recibida ciudad para consulta de clima pendiente");
    waitingForCity.delete(from);
    await handleWeatherQuery(messageText, from); // Tratar el mensaje como nombre de ciudad
    return res.sendStatus(200);
  }

  // 1. Si es clima, responde clima y termina
  if (isWeatherQuery(messageText)) {
    console.log("🌦️ Consulta de clima detectada");
    
    // Verificar si el mensaje tiene una ciudad
    const cityMatch = messageText.match(/(?:en|para|de)\s+([A-Za-zÁÉÍÓÚáéíóúÑñ\s]+)(\?|$)/i);
    if (!cityMatch) {
      console.log("❓ No se detectó ciudad en la consulta de clima");
      await sendWhatsAppMessage(from, "¿Para qué ciudad querés saber el clima?");
      waitingForCity.add(from);
      return res.sendStatus(200);
    }
    
    await handleWeatherQuery(messageText, from);
    return res.sendStatus(200);
  }

  // 2. Si es un saludo, responde saludo y termina
  if (isGreeting(messageText)) {
    console.log("👋 Saludo detectado");
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