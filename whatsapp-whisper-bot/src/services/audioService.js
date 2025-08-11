class AudioService {
  constructor() {
    // Initialize any necessary properties or configurations
  }

  async saveAudioFile(audioBuffer, fileName) {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(__dirname, '../../uploads', fileName);

    return new Promise((resolve, reject) => {
      fs.writeFile(filePath, audioBuffer, (err) => {
        if (err) {
          return reject(err);
        }
        resolve(filePath);
      });
    });
  }

  async convertAudioFormat(filePath, targetFormat) {
    const ffmpeg = require('fluent-ffmpeg');

    return new Promise((resolve, reject) => {
      const outputFilePath = filePath.replace(/\.[^/.]+$/, `.${targetFormat}`);
      ffmpeg(filePath)
        .toFormat(targetFormat)
        .on('end', () => {
          resolve(outputFilePath);
        })
        .on('error', (err) => {
          reject(err);
        })
        .save(outputFilePath);
    });
  }

  async sendToWhisper(filePath) {
    const axios = require('axios');
    const fs = require('fs');

    const audioData = fs.createReadStream(filePath);
    const whisperApiUrl = process.env.WHISPER_API_URL; // Ensure this is set in your .env

    try {
      const response = await axios.post(whisperApiUrl, audioData, {
        headers: {
          'Content-Type': 'audio/wav', // Adjust based on your audio format
          'Authorization': `Bearer ${process.env.WHISPER_API_KEY}`, // Ensure this is set in your .env
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Error sending audio to Whisper: ${error.message}`);
    }
  }
}

module.exports = AudioService;