const express = require('express');
const router = express.Router();
const { verifyWebhook } = require('../middleware/auth');
const { handleOnboarding } = require('../middleware/onboarding');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { getGPTResponse, parseReminderWithOpenAI } = require('../services/openai');
const { downloadWhatsAppAudio, transcribeWithWhisper } = require('../services/audio');

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
        // Crear y programar recordatorio
        const reminder = new Reminder({
          phone: from,
          title: parsed.data.title,
          emoji: findBestEmoji(parsed.data.title),
          date: new Date(parsed.data.date + 'T' + parsed.data.time),
          notifyAt: new Date(parsed.data.date + 'T' + parsed.data.time)
        });

        await reminder.save();
        console.log('💾 Recordatorio guardado:', reminder);
        
        const confirmMessage = `¡Listo! Te recordaré "${reminder.title}" ${reminder.emoji} el ${reminder.date.toLocaleString()}`;
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