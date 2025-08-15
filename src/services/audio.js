const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { openai } = require('./openai');
const axios = require('axios');
const FormData = require('form-data');
const { whatsappToken, openaiToken } = require('../config/environment');

ffmpeg.setFfmpegPath(ffmpegPath);

const audioDir = path.join(__dirname, '../../temp');
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

async function downloadWhatsAppAudio(audioId) {
  try {
    const mediaUrl = `https://graph.facebook.com/v21.0/${audioId}`;
    const response = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${whatsappToken}` }
    });

    const mediaData = await axios.get(response.data.url, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${whatsappToken}` }
    });

    const audioPath = path.join(audioDir, `${audioId}.ogg`);
    fs.writeFileSync(audioPath, mediaData.data);
    return audioPath;
  } catch (err) {
    console.error('Error descargando audio:', err);
    throw err;
  }
}

async function transcribeAudio(audioPath) {
  const modelos = ['whisper-1', 'gpt-4o-transcribe'];
  let lastError;

  for (const modelo of modelos) {
    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    form.append('model', modelo);
    form.append('language', 'es');

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${openaiToken}`
          }
        }
      );
      // Limpia el archivo temporal después de transcribir
      fs.unlink(audioPath, () => {});
      return response.data.text;
    } catch (err) {
      lastError = err;
      console.error(`Error con modelo ${modelo}:`, err.response?.data || err.message);
      // Si es error de modelo no disponible, intenta el siguiente
      if (modelo === 'whisper-1' && err.response?.status === 400) {
        continue;
      } else {
        break;
      }
    }
  }

  // Limpia el archivo si no se pudo transcribir
  fs.unlink(audioPath, () => {});
  throw new Error('No se pudo transcribir el audio con ningún modelo. Último error: ' + (lastError.response?.data?.error?.message || lastError.message));
}

module.exports = { downloadWhatsAppAudio, transcribeAudio };