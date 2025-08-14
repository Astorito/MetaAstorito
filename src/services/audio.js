const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { openai } = require('./openai');
const axios = require('axios');
const { whatsappToken } = require('../config/environment');

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

async function transcribeWithWhisper(audioPath) {
  try {
    console.log('Iniciando transcripción...');
    
    const mp3Path = audioPath.replace('.ogg', '.mp3');
    
    await new Promise((resolve, reject) => {
      ffmpeg(audioPath)
        .toFormat('mp3')
        .on('error', reject)
        .on('end', resolve)
        .save(mp3Path);
    });

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(mp3Path),
      model: "whisper-1",
      language: "es"
    });

    fs.unlinkSync(mp3Path);
    return transcription.text;

  } catch (err) {
    console.error('Error en transcripción:', err);
    throw new Error(`Error transcribiendo audio: ${err.message}`);
  } finally {
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  }
}

module.exports = { downloadWhatsAppAudio, transcribeWithWhisper };