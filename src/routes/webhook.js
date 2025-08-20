const express = require('express');
const router = express.Router();
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { handleWeatherQuery } = require('../services/weather');
const { parseReminderWithOpenAI, getGPTResponse, classifyMessage } = require('../services/openai');
const { handleAudioMessage } = require('../services/transcription');
const Reminder = require('../models/reminder');
const User = require('../models/user');
const List = require('../models/list');
const { DateTime } = require('luxon');
const { findBestEmoji } = require('../utils/emoji');
const { getContext, saveContext, clearContext } = require('../services/context');
const { logIncomingInteraction } = require('../services/analytics');

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

  // Registrar la interacción entrante
  if (messageText) {
    await logIncomingInteraction(from, messageType || "text", messageText);
  }
  
  // Buscar usuario o crear uno nuevo si no existe
  let user = await User.findOne({ phone: from });
  const isNewUser = !user;
  if (isNewUser) {
    user = new User({ 
      phone: from,
      name: 'Usuario',
      onboardingCompleted: false
    });
    await user.save();
    console.log("👤 Nuevo usuario creado:", from);
  } else {
    console.log(`👤 Usuario existente: ${from}, onboardingCompleted: ${user.onboardingCompleted}`);
    // Asegurarse de que usuarios existentes tengan onboardingCompleted=true
    if (!user.hasOwnProperty('onboardingCompleted')) {
      console.log(`⚠️ Usuario sin propiedad onboardingCompleted, actualizando...`);
      user.onboardingCompleted = true;
      await user.save();
    }
  }

  // Después de buscar al usuario
  console.log(`👤 Usuario encontrado: ${from}, onboardingCompleted: ${user.onboardingCompleted}`);

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

  // Verificar si el usuario es nuevo y necesita pasar por onboarding
  if (!user.onboardingCompleted) {
    console.log("🚦 Usuario nuevo, iniciando onboarding");
    return await handleOnboarding(from, messageText, user, res);
  }

  // Si el usuario está en medio del proceso de onboarding
  if (onboardingState[from]) {
    console.log("🚦 Continuando onboarding en proceso");
    return await handleOnboarding(from, messageText, user, res);
  }

  // Si el usuario estaba esperando ciudad para clima, procesar directamente
  if (waitingForCity.has(from)) {
    console.log("🌆 Recibida ciudad para consulta de clima pendiente");
    waitingForCity.delete(from);
    await handleWeatherQuery(messageText, from); // Tratar el mensaje como nombre de ciudad
    return res.sendStatus(200);
  }

  // Verificar si es un saludo para reiniciar onboarding si es necesario
  if (/^(hola|buenas|buen día|buenas tardes|buenas noches)$/i.test(messageText.trim())) {
    console.log("👋 Saludo detectado");
    
    // Saludar al usuario por su nombre
    const welcomeBack = `¡Hola de nuevo ${user.name}! ¿En qué puedo ayudarte hoy?`;
    await sendWhatsAppMessage(from, welcomeBack);
    return res.sendStatus(200);
  }

  // Detectar si es una pregunta sobre Astorito
  const aboutAstorito = /que( es|.s)? astorito|para que sirve|para que servis|que (hace|puedes hacer|podes hacer|sabes hacer)|como funciona|ayuda|help|instrucciones|comandos|funcionalidades|capacidades|que sos|qué eres/i.test(messageText);

  if (aboutAstorito) {
    console.log("❓ Pregunta sobre Astorito detectada");
    
    const capabilitiesMessage = 
      `🤖 *¿Qué es Astorito?*\n\n` +
      `Soy tu asistente personal por WhatsApp. Puedo ayudarte con:\n\n` +
      `🗓️ *Recordatorios*\n` +
      `• "Recuérdame llamar al médico mañana a las 10am"\n` +
      `• "Agenda reunión con Juan el viernes a las 15hs"\n\n` +
      
      `🌤️ *Consultas de clima*\n` +
      `• "¿Cómo está el clima en Buenos Aires?"\n` +
      `• "Clima para los próximos 3 días en Rosario"\n\n` +
      
      `🎙️ *Mensajes de voz*\n` +
      `• Puedes enviarme notas de voz y las entenderé\n\n` +
      
      `📋 *Listas*\n` +
      `• "Crear lista de compras: leche, pan, huevos"\n\n` +
      
      `🔄 *Recordatorios recurrentes*\n` +
      `• "Recordarme tomar agua todos los días a las 10am"\n\n` +
      
      `🎂 *Recordatorios de cumpleaños*\n` +
      `• "Recuérdame el cumpleaños de María el 20 de junio"\n\n` +
      
      `✨ *Astorito Premium*\n` +
      `• Resúmenes de noticias\n` +
      `• Conexión con Google Calendar\n\n` +
      
      `¿En qué puedo ayudarte hoy?`;
    
    await sendWhatsAppMessage(from, capabilitiesMessage);
    return res.sendStatus(200);
  }

  // Detección y manejo de cumpleaños
  if (/cumpleaños|cumpleanos|cumple de|cumple|recordar.*cumple/i.test(messageText)) {
    console.log("🎂 Recordatorio de cumpleaños detectado");
    
    // Extraer nombre y fecha con una expresión regular simple
    const match = messageText.match(/cumple[añanos]* de ([a-záéíóúñ\s]+) el (\d{1,2}) de ([a-záéíóúñ]+)/i);
    if (match) {
      const nombre = match[1].trim();
      const dia = match[2].padStart(2, '0');
      const mesTexto = match[3].toLowerCase();
      // Mapeo de meses a número
      const meses = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04', 'mayo': '05', 'junio': '06',
        'julio': '07', 'agosto': '08', 'septiembre': '09', 'setiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
      };
      const mes = meses[mesTexto];
      if (mes) {
        // Usar el año actual o el próximo si ya pasó
        const hoy = new Date();
        let año = hoy.getFullYear();
        const fechaCumple = new Date(`${año}-${mes}-${dia}T00:00:00-03:00`);
        if (fechaCumple < hoy) año++;
        // Guardar como recordatorio especial
        const reminder = new Reminder({
          phone: from,
          title: `Cumpleaños de ${nombre}`,
          emoji: "🎂",
          date: new Date(`${año}-${mes}-${dia}T09:00:00-03:00`), // 9am por defecto
          notifyAt: new Date(`${año}-${mes}-${dia}T09:00:00-03:00`),
          sent: false
        });
        await reminder.save();
        console.log(`✅ Recordatorio de cumpleaños guardado para ${nombre}`);
        
        await sendWhatsAppMessage(from, `🎂 ¡Listo! Te recordaré el cumpleaños de ${nombre} el ${dia} de ${mesTexto} a las 9:00 am.`);
        return res.sendStatus(200);
      }
    }
    await sendWhatsAppMessage(from, "No pude entender la fecha o el nombre del cumpleaños. Por favor, decime: \"Recordame el cumpleaños de [nombre] el [día] de [mes]\"");
    return res.sendStatus(200);
  }

  // Detección y manejo de listas
  if (/crear lista|nueva lista|lista de|hacer una lista/i.test(messageText)) {
    console.log("📋 Solicitud de creación de lista detectada");
    
    // Extraer tipo de lista y elementos
    const listMatch = messageText.match(/lista (?:de|para) ([a-záéíóúñ\s]+?)(?:\:|;|con|que tenga)/i);
    if (!listMatch) {
      await sendWhatsAppMessage(from, "No pude entender qué tipo de lista querés crear. Por favor, decime algo como: \"Crear lista de compras: leche, pan, huevos\"");
      return res.sendStatus(200);
    }
    
    const listName = listMatch[1].trim();
    
    // Extraer los elementos (todo lo que sigue después de ":")
    const itemsText = messageText.split(/\:|;/)[1];
    if (!itemsText) {
      await sendWhatsAppMessage(from, `Entendí que querés crear una lista de "${listName}" pero no mencionaste los elementos. ¿Qué elementos querés agregar?`);
      return res.sendStatus(200);
    }
    
    // Convertir el texto de elementos en un array de items
    const items = itemsText.split(',')
                          .map(item => item.trim())
                          .filter(item => item.length > 0)
                          .map(item => ({ text: item, checked: false }));
    
    if (items.length === 0) {
      await sendWhatsAppMessage(from, `Entendí que querés crear una lista de "${listName}" pero no pude identificar los elementos. Por favor, separalos por comas.`);
      return res.sendStatus(200);
    }
    
    try {
      // Guardar la lista en la base de datos
      const list = new List({
        phone: from,
        name: listName,
        items: items
      });
      
      await list.save();
      console.log(`✅ Lista "${listName}" guardada con ${items.length} elementos`);
      
      // Crear mensaje de confirmación
      const listMessage = 
        `📋 ¡Lista de ${listName} creada!\n\n` +
        items.map((item, index) => `${index + 1}. ${item.text}`).join('\n') + 
        `\n\nPodés agregar más elementos diciendo: "Agregar [item] a mi lista de ${listName}"`;
      
      await sendWhatsAppMessage(from, listMessage);
    } catch (err) {
      console.error('Error creando lista:', err);
      await sendWhatsAppMessage(from, "Ocurrió un error al guardar tu lista. Por favor intentá nuevamente.");
    }
    
    return res.sendStatus(200);
  }

  // Detección para ver una lista específica
  if (/ver (mi|la) lista|mostrar (mi|la) lista|listar/i.test(messageText)) {
    console.log("📋 Solicitud para ver una lista detectada");
    
    // Extraer el nombre de la lista
    const viewMatch = messageText.match(/lista (?:de|del|para) ([a-záéíóúñ\s]+)/i);
    if (!viewMatch) {
      // Si no se especifica qué lista, mostrar todas las listas del usuario
      try {
        const userLists = await List.find({ phone: from }).sort({ createdAt: -1 }).limit(10);
        
        if (userLists.length === 0) {
          await sendWhatsAppMessage(from, "No tienes ninguna lista guardada. Puedes crear una diciendo: \"Crear lista de compras: pan, leche, huevos\"");
          return res.sendStatus(200);
        }
        
        const listsMessage = 
          `📋 *Tus listas:*\n\n` +
          userLists.map(list => `• ${list.name} (${list.items.length} items)`).join('\n') +
          `\n\nPara ver una lista específica dime: "Ver mi lista de [nombre]"`;
        
        await sendWhatsAppMessage(from, listsMessage);
        return res.sendStatus(200);
      } catch (err) {
        console.error('Error obteniendo listas:', err);
        await sendWhatsAppMessage(from, "Ocurrió un error al consultar tus listas.");
        return res.sendStatus(200);
      }
    }
    
    // Si se especificó una lista, buscarla
    const listName = viewMatch[1].trim();
    
    try {
      // Buscar una lista que contenga ese nombre (busqueda flexible)
      const list = await List.findOne({ 
        phone: from,
        name: { $regex: new RegExp(listName, 'i') }
      });
      
      if (!list) {
        await sendWhatsAppMessage(from, `No encontré ninguna lista llamada "${listName}". ¿Querés crear una nueva?`);
        return res.sendStatus(200);
      }
      
      // Mostrar los elementos de la lista
      const checkedItems = list.items.filter(item => item.checked);
      const uncheckedItems = list.items.filter(item => !item.checked);
      
      const listMessage = 
        `📋 *Lista de ${list.name}*\n\n` +
        (uncheckedItems.length > 0 ? 
          `*Pendientes:*\n${uncheckedItems.map((item, i) => `${i+1}. ${item.text}`).join('\n')}\n\n` : 
          "") +
        (checkedItems.length > 0 ? 
          `*Completados:*\n${checkedItems.map((item, i) => `✅ ${item.text}`).join('\n')}\n\n` : 
          "") +
        `\nCreada el ${new Date(list.createdAt).toLocaleDateString('es-AR')}` +
        `\n\nPodés agregar más elementos diciendo: "Agregar [item] a mi lista de ${list.name}"`;
      
      await sendWhatsAppMessage(from, listMessage);
    } catch (err) {
      console.error('Error obteniendo lista:', err);
      await sendWhatsAppMessage(from, "Ocurrió un error al consultar tu lista.");
    }
    
    return res.sendStatus(200);
  }

  // CLASIFICACIÓN DE MENSAJES con OpenAI
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
          const eventDate = DateTime.fromISO(`${parsed.data.date}T${parsed.data.time}`)
                          .setZone('America/Argentina/Buenos_Aires');
                          
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

          await sendWhatsAppMessage(from, confirmMessage, "RECORDATORIO");
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
          
          // Añadir mensaje informativo
          respuesta += "\n\n✨Para otras preguntas generales, te recomiendo usar https://chatgpt.com/";
          
          await sendWhatsAppMessage(from, respuesta, "GENERALQUERY");
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

// Función auxiliar para manejar el flujo de onboarding
async function handleOnboarding(from, messageText, user, res) {
  // Iniciar onboarding si no está en proceso
  if (!onboardingState[from]) {
    onboardingState[from] = { step: 1 };
    await sendWhatsAppMessage(from, "¡Hola! Soy Astorito, gracias por escribirme. ¿Cómo es tu nombre?");
    return res.sendStatus(200);
  }
  
  // Procesar según el paso actual
  if (onboardingState[from].step === 1) {
    // El usuario acaba de responder con su nombre
    const userName = messageText.trim();
    
    // Guardar nombre en la base de datos
    user.name = userName;
    user.onboardingCompleted = true;  // Marcamos onboarding como completado
    await user.save();
    console.log(`👤 Nombre de usuario actualizado: ${userName} para ${from}`);
    
    onboardingState[from].name = userName;
    onboardingState[from].step = 2;
    
    // Segundo mensaje de onboarding con las capacidades
    const welcomeMessage = 
      `Genial ${userName}!\n\n` +
      "Puedo ayudarte con:\n\n" +
      "🗓️ *Recordatorios*: Dime algo como \"Recuérdame reunión con Juan mañana a las 3 pm\"\n\n" +
      "🌤️ *Clima*: Pregúntame \"¿Cómo está el clima en Buenos Aires?\" o \"Clima para los próximos 3 días\"\n\n" +
      "🎙️ *Mensajes de voz*: También puedes enviarme notas de voz y las entenderé\n\n" +
      "📋 *Listas*: \"Crear lista de compras: leche, pan, huevos\"\n\n" +
      "🔄 *Recordatorios recurrentes*: \"Recuérdame hacer ejercicio todos los lunes a las 7am\"\n\n" +
      "🎂 *Recordatorios de cumpleaños*: \"Recuérdame el cumpleaños de Juan el 15 de mayo\"\n\n" +
      "Además con Astorito Premium podrás:\n" +
      "📰 Recibir resúmenes de noticias\n" +  
      "🔄 Conectarlo con tu Google Calendar\n\n" +
      "¿En qué puedo ayudarte hoy?";
    
    await sendWhatsAppMessage(from, welcomeMessage);
    
    // Eliminar estado de onboarding
    delete onboardingState[from];
    
    return res.sendStatus(200);
  } else {
    // Paso inesperado, reiniciar el onboarding
    delete onboardingState[from];
    return res.sendStatus(200);
  }
}

module.exports = router;
