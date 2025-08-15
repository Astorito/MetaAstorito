const express = require('express');
const router = express.Router();
const { verifyWebhook } = require('../middleware/auth');
const { handleOnboarding } = require('../middleware/onboarding');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { getGPTResponse, parseReminderWithOpenAI } = require('../services/openai');
const { downloadWhatsAppAudio, transcribeWithWhisper } = require('../services/audio');
const { findBestEmoji } = require('../utils/emoji');
const Reminder = require('../models/reminder');
const { DateTime } = require('luxon');

router.post("/", async (req, res) => {
  try {
    console.log('🔔 Webhook recibido:', new Date().toISOString());
    
    const incomingMessage = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = incomingMessage?.from;
    const messageText = incomingMessage?.text?.body;
    const messageType = incomingMessage?.type;

    console.log('📝 Mensaje:', {
      from,
      text: messageText,
      type: messageType
    });

    if (!incomingMessage || !from) {
      console.log("❌ Mensaje inválido");
      return res.sendStatus(200);
    }

    // Verificar onboarding
    const onboardingResponse = await handleOnboarding(from, messageText);
    if (onboardingResponse) {
      console.log('🆕 Respuesta onboarding:', onboardingResponse);
      await sendWhatsAppMessage(from, onboardingResponse.message);
      if (!onboardingResponse.shouldContinue) {
        return res.sendStatus(200);
      }
    }

    // Procesar mensaje
    try {
      console.log('🔄 Procesando mensaje:', messageText);
      const parsed = await parseReminderWithOpenAI(messageText);
      console.log('✨ Mensaje parseado:', parsed);
      
      if (parsed.type === "reminder") {
        console.log('⏰ Creando recordatorio:', parsed.data);
        
        // Calcular fecha de notificación
        const eventDate = DateTime.fromISO(`${parsed.data.date}T${parsed.data.time}`);
        let notifyAt = eventDate;
        
        if (parsed.data.notify?.includes('horas antes')) {
          const hours = parseInt(parsed.data.notify);
          notifyAt = eventDate.minus({ hours });
        } else if (parsed.data.notify?.includes('minutos antes')) {
          const minutes = parseInt(parsed.data.notify);
          notifyAt = eventDate.minus({ minutes });
        }

        // Crear recordatorio
        const reminder = new Reminder({
          phone: from,
          title: parsed.data.title,
          emoji: findBestEmoji(parsed.data.title),
          date: eventDate.toJSDate(),
          notifyAt: notifyAt.toJSDate(),
          sent: false
        });

        await reminder.save();
        console.log('💾 Recordatorio guardado:', reminder);
        
        const confirmMessage =
          `✅ Recordatorio creado!\n\n` +
          `${reminder.emoji} *${reminder.title}*\n` +
          `📅 Fecha: ${eventDate.toFormat("EEEE d 'de' MMMM", { locale: 'es' })} a las ${eventDate.toFormat('HH:mm')}\n` +
          `⏰ Te avisaré: ${notifyAt.toFormat("EEEE d 'de' MMMM", { locale: 'es' })} a las ${notifyAt.toFormat('HH:mm')}\n\n` +
          `Avisanos si queres agendar otro evento!`;

        await sendWhatsAppMessage(from, confirmMessage);
      } else {
        await sendWhatsAppMessage(from, parsed.content);
      }
    } catch (err) {
      console.error('❌ Error procesando mensaje:', err);
      await sendWhatsAppMessage(from, "Disculpa, tuve un problema procesando tu mensaje. ¿Podrías intentarlo de nuevo?");
    }

    return res.sendStatus(200);
  } catch (err) {
    console.error("❌ Error en webhook:", err);
    return res.sendStatus(500);
  }
});

module.exports = router;