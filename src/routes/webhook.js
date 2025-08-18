const express = require('express');
const router = express.Router();
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { handleWeatherQuery } = require('../services/weather');
const { parseReminderWithOpenAI, getGPTResponse, classifyMessage } = require('../services/openai');
const { handleAudioMessage } = require('../services/transcription');
const Reminder = require('../models/reminder');
const User = require('../models/user');
const { DateTime } = require('luxon');
const { findBestEmoji } = require('../utils/emoji');
const { getContext, clearContext } = require('../services/context');

// Set para recordar usuarios esperando ciudad para clima
const waitingForCity = new Set();
// Objeto para seguimiento del onboarding
const onboardingState = {};

router.post("/", async (req, res) => {
  // Log completo para debug
  console.log("🔔 Webhook recibido (raw body):", JSON.stringify(req.body, null, 2));

  // Verificar si es una notificación de estado (no debemos procesarla)
  if (req.body.entry?.[0]?.changes?.[0]?.value?.statuses) {
    console.log("ℹ️ Ignorando notificación de estado de mensaje");
    return res.sendStatus(200);
  }

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
      
      // Extraer texto o ID de audio según el tipo de mensaje
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

  console.log("🔔 Webhook procesando:", { from, messageType, audioId, messageText });

  if (!from) {
    console.log("❌ Mensaje sin remitente");
    return res.sendStatus(200);
  }

  // Buscar usuario o crear uno nuevo si no existe
  let user = await User.findOne({ phone: from });
  if (!user) {
    user = new User({ phone: from });
    await user.save();
    console.log("👤 Nuevo usuario creado:", from);
  }

  // MANEJAR AUDIO: si es un mensaje de audio, procesarlo
  if (messageType === 'audio' && audioId) {
    console.log("🎤 Procesando mensaje de audio");
    
    // Procesar el audio y obtener la transcripción
    messageText = await handleAudioMessage(audioId, from);
    
    // Si no obtuvimos transcripción, terminamos
    if (!messageText) {
      console.log("❌ No se pudo transcribir el audio");
      return res.sendStatus(200);
    }
    
    console.log("🎤 Audio procesado como comando:", messageText);
    // Continúa con el flujo normal usando la transcripción como mensaje
  }

  // Verificar que tenemos texto para procesar
  if (!messageText) {
    console.log("❌ No hay texto para procesar");
    return res.sendStatus(200);
  }

  // Manejo del proceso de onboarding
  if (onboardingState[from]) {
    // Estamos en proceso de onboarding
    if (onboardingState[from].step === 1) {
      // El usuario acaba de responder con su nombre
      const userName = messageText.trim();
      
      // Guardar nombre en la base de datos
      user.name = userName;
      await user.save();
      console.log(`👤 Nombre de usuario actualizado: ${userName} para ${from}`);
      
      onboardingState[from].name = userName;
      onboardingState[from].step = 2;
      
      // Segundo mensaje de onboarding con las capacidades
      const welcomeMessage = 
        `Genial ${userName}!\n\n` +
        "Puedo ayudarte con:\n\n" +
        "🗓️ *Recordatorios*: Dime algo como \"Recuérdame reunión con Juan mañana a las 3 pm\"\n\n" +
        "🌤️ *Clima*: Pregúntame \"¿Cómo está el clima en Buenos Aires?\"\n\n" +
        "🎙️ *Mensajes de voz*: También puedes enviarme notas de voz y las entenderé\n\n" +
        "Además con Astorito Premium podrás:\n" +
        "📋 Generar Listas - Supermercado, viajes, etc\n" +
        "❓ Consultas Generales\n" +
        "📅 Armar tu cronograma de la semana\n" +
        "🔄 Conectarlo con tu Google Calendar\n\n" +
        "¿En qué puedo ayudarte hoy?";
      
      await sendWhatsAppMessage(from, welcomeMessage);
      return res.sendStatus(200);
    } else {
      // Ya completó el onboarding, eliminar el estado
      delete onboardingState[from];
      // Continuar con el flujo normal
    }
  }

  // Si el usuario estaba esperando ciudad para clima, procesar directamente
  if (waitingForCity.has(from)) {
    console.log("🌆 Recibida ciudad para consulta de clima pendiente");
    waitingForCity.delete(from);
    await handleWeatherQuery(messageText, from); // Tratar el mensaje como nombre de ciudad
    return res.sendStatus(200);
  }

  // Verificar si es un saludo para iniciar onboarding
  if (/^(hola|buenas|buen día|buenas tardes|buenas noches)$/i.test(messageText.trim())) {
    console.log("👋 Saludo detectado - Iniciando onboarding");
    
    // Si ya tenemos su nombre, no preguntar de nuevo
    if (user && user.name && user.name !== 'Usuario') {
      const welcomeBack = `¡Hola de nuevo ${user.name}! ¿En qué puedo ayudarte hoy?`;
      await sendWhatsAppMessage(from, welcomeBack);
      return res.sendStatus(200);
    }
    
    // Iniciar onboarding paso 1
    onboardingState[from] = { step: 1 };
    await sendWhatsAppMessage(from, "¡Hola! Soy Astorito, gracias por escribirme. ¿Cómo es tu nombre?");
    return res.sendStatus(200);
  }

  // NUEVA IMPLEMENTACIÓN: Clasificar el mensaje con OpenAI
  try {
    console.log("🔍 Clasificando mensaje con OpenAI...");
    const messageCategory = await classifyMessage(messageText);
    console.log(`📊 Categoría del mensaje: ${messageCategory}`);

    // Procesar según la categoría
    switch (messageCategory) {
      case 'CLIMA':
        console.log("🌦️ Consulta de clima detectada");
        
        // Manejar la consulta de clima (la función handleWeatherQuery ya tiene la lógica de contexto)
        await handleWeatherQuery(messageText, from);
        return res.sendStatus(200);
        
      case 'RECORDATORIO':
        console.log("🗓️ Solicitud de recordatorio detectada");
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
        } else {
          // Si no se pudo extraer los datos del recordatorio
          await sendWhatsAppMessage(from, "No pude entender los detalles del recordatorio. Por favor, especifica fecha, hora y descripción del evento.");
        }
        return res.sendStatus(200);
        
      case 'GENERALQUERY':
      default:
        console.log("❓ Consulta general detectada");
        try {
          // Obtener respuesta corta de GPT
          const gpt = await getGPTResponse(messageText);
          let respuesta = gpt.content;
          
          // Añadir mensaje informativo (MODIFICADO)
          respuesta += "\n\n✨Para otras preguntas generales, te recomiendo usar https://chatgpt.com/";
          
          await sendWhatsAppMessage(from, respuesta);
        } catch (err) {
          console.error("❌ Error obteniendo respuesta de GPT:", err);
          await sendWhatsAppMessage(from, "Lo siento, no pude procesar tu consulta en este momento.");
        }
        return res.sendStatus(200);
    }
  } catch (err) {
    console.error("❌ Error procesando mensaje:", err);
    await sendWhatsAppMessage(from, "Ocurrió un error procesando tu mensaje.");
    return res.sendStatus(200);
  }
});

module.exports = router;
