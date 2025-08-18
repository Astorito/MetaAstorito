const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const { sendWhatsAppMessage } = require('./whatsapp');
const path = require('path');
const os = require('os');

// Descargar el archivo de audio de WhatsApp
async function downloadAudio(mediaId, token) {
  try {
    const response = await axios({
      method: 'GET',
      url: `https://graph.facebook.com/v17.0/${mediaId}`,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const mediaUrl = response.data.url;
    
    const mediaResponse = await axios({
      method: 'GET',
      url: mediaUrl,
      headers: {
        'Authorization': `Bearer ${token}`
      },
      responseType: 'stream'
    });

    // Crear un nombre de archivo temporal
    const tempFilePath = path.join(os.tmpdir(), `whatsapp_audio_${Date.now()}.ogg`);
    const writer = fs.createWriteStream(tempFilePath);
    
    mediaResponse.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(tempFilePath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('Error descargando audio:', error);
    throw new Error('No se pudo descargar el archivo de audio');
  }
}

// Transcribir audio usando la API de OpenAI
async function transcribeAudio(filePath) {
  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'es');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          ...formData.getHeaders()
        }
      }
    );

    // Eliminar el archivo temporal después de usarlo
    fs.unlink(filePath, (err) => {
      if (err) console.error('Error eliminando archivo temporal:', err);
    });

    return response.data.text;
  } catch (error) {
    console.error('Error transcribiendo audio:', error);
    // Intentar eliminar el archivo incluso si falla
    fs.unlink(filePath, () => {});
    throw new Error('No se pudo transcribir el audio');
  }
}

// Manejar mensajes de audio
async function handleAudioMessage(audioId, from, token) {
  try {
    // Indicar que estamos procesando (opcional, puedes eliminar esta línea también)
    await sendWhatsAppMessage(from, "🎤 Procesando tu mensaje...");
    
    // Descargar el archivo de audio
    const audioPath = await downloadAudio(audioId, token);
    
    // Transcribir el audio
    const transcription = await transcribeAudio(audioPath);
    
    // NO enviamos la transcripción, simplemente la devolvemos para procesarla
    console.log(`🎤 Audio transcrito: "${transcription}"`);
    
    return transcription;
  } catch (error) {
    console.error('Error procesando audio:', error);
    await sendWhatsAppMessage(from, "❌ Lo siento, no pude procesar el audio. Por favor, intenta de nuevo.");
    return null;
  }
}

module.exports = { handleAudioMessage };

// En src/routes/webhook.js, agrega esta importación
const { handleAudioMessage } = require('../services/transcription');

// Dentro de tu router.post("/", async (req, res) => {...})
// Después de extraer los datos de la estructura de WhatsApp

// Extraer datos de la estructura real de WhatsApp
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
    } else if (messageType === 'audio') {
      audioId = message.audio?.id;
    }
  }
} catch (e) {
  console.error('Error extrayendo datos del mensaje:', e);
}

console.log("🔔 Webhook recibido:", { from, messageType, messageText });

if (!from) {
  console.log("❌ Mensaje inválido");
  return res.sendStatus(200);
}

// MANEJAR AUDIO: si es un mensaje de audio, procesarlo
if (messageType === 'audio' && audioId) {
  console.log("🎤 Mensaje de audio recibido, ID:", audioId);
  const token = process.env.WHATSAPP_TOKEN;
  
  // Procesar el audio y obtener la transcripción directamente como texto
  messageText = await handleAudioMessage(audioId, from, token);
  
  // Si no obtuvimos transcripción, terminamos
  if (!messageText) {
    return res.sendStatus(200);
  }
  
  // No mostramos la transcripción, simplemente continuamos con el flujo
  console.log("🎤 Audio procesado como comando:", messageText);
  // Continúa con el flujo normal usando la transcripción como mensaje
}

// VERIFICACIÓN: Asegurarse de tener texto para procesar
if (!messageText) {
  console.log("❌ No hay texto para procesar");
  return res.sendStatus(200);
}

// A PARTIR DE AQUÍ COMIENZA EL FLUJO NORMAL DE PROCESAMIENTO
// Si el usuario estaba esperando ciudad para clima, procesar directamente
if (waitingForCity.has(from)) {
  console.log("🌆 Recibida ciudad para consulta de clima pendiente");
  waitingForCity.delete(from);
  await handleWeatherQuery(messageText, from);
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
  // ... resto del código de procesamiento de recordatorios ...
} catch (err) {
  console.error("❌ Error procesando mensaje:", err);
  await sendWhatsAppMessage(from, "Ocurrió un error procesando tu mensaje.");
  return res.sendStatus(200);
}